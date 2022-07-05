const dbus = require("dbus-next");
dbus.setBigIntCompat(true);
const bus = dbus.sessionBus();

function removePrefix(text: string, prefix: string): string {
    if (prefix.length > text.length)
        return text;
    if (text.indexOf(prefix) == 0) {
        return text.slice(prefix.length);
    }
    return text;
}

export function removeSuffix(text: string, suffix: string): string {
    if (suffix.length > text.length)
        return text;
    if (text.lastIndexOf(suffix) == text.length - suffix.length) {
        return text.slice(0, text.length - suffix.length);
    }
    return text;
}

export function replaceAll(text: string, base: string, replacement: string) {
    if (base.length == 0) {
        return text;
    }
    while (text.includes(base)) {
        text = text.replace(base, replacement);
    }
    return text;
}

export function getCurrentTime(): number {
    return new Date().getTime();
}

function matchRuleShort(text: string, match: string) {
    var escapeRegex = (text: string) => text.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
    return new RegExp("^" + match.split("*").map(escapeRegex).join(".*") + "$").test(text);
}

export class MediaAPI {
    _cmd: (args: string[], raise_error: boolean) => Promise<[string, boolean]>;
    _load: (path: string) => Promise<string>;
    _save: (path: string, content: string) => void;
    _log: ((msg: string) => void) | null;

    MAX_TITLE_LENGTH: number = -1;
    HIDE_DELAY: number = 1.0;

    _config: any = null;

    _first_update: boolean = true;
    currentTitleScroll: number = 0;
    active_media_names: Array<string> = [];
    vlc_dlna_cache: any = {};
    hide_delay_start_time: number = -1;

    sources: Source[] = [];
    current_source: Source | null = null;

    setVisibleCallback: ((visible: boolean) => void) | null = null;
    setCanGoNextCallback: ((can_go: boolean) => void) | null = null;
    setCanGoPreviousCallback: ((can_go: boolean) => void) | null = null;
    setTitleCallback: ((title: string) => void) | null = null;
    setVolumeCallback: ((volume: number, muted: boolean) => void) | null = null;
    setPlayingCallback: ((playing: boolean) => void) | null = null;

    constructor(cmd_function: (args: string[], raise_error: boolean) => Promise<[string, boolean]>, load_function: (path: string) => Promise<string>, save_function: (path: string, content: string) => void, log_function: ((msg: string) => void) | null) {
        this._cmd = cmd_function;
        this._load = load_function;
        this._save = save_function;
        this._log = log_function;
    }

    getConfigPath() {
        return "/.config/mediapanel-config.json";
    }

    async onConfigChanged() {
        this.sources = [];
        this.current_source = null;
        this.beginHide();
    }

    async log(msg: string) {
        if (this._log) {
            this._log(msg);
        }
    }

    cmd(args: string[], raise_error: boolean = true) {
        return this._cmd(args, raise_error);
    }

    async loadConfig(message_callback: ((msg: string) => void) | null = null) {
        let original = this._config;
        try {
            this._config = JSON.parse(await this._load(this.getConfigPath()));
            if (message_callback) {
                message_callback(`Config file at '${this.getConfigPath()}' loaded successfully`);
            }
        }
        catch(err: any) {
            this._config = original == null ? {} : original;
            if (message_callback) {
                message_callback(err.toString());
            }
        }

        this.onConfigChanged();
    }

    async saveConfig(message_callback: ((msg: string) => void) | null = null) {
        try {
            this._save(this.getConfigPath(), JSON.stringify(this._config, null, 2));
            if (message_callback) {
                message_callback(`Config file at '${this.getConfigPath()}' saved successfully`);
            }
        }
        catch (err: any) {
            if (message_callback) {
                message_callback(err.toString());
            }
            throw err;
        }
    }

    beginHide() {
        this.hide_delay_start_time = getCurrentTime();
    }

    cancelHide() {
        this.hide_delay_start_time = -1;
    }
    
    processHide() {
        if (this.hide_delay_start_time >= 0 && (getCurrentTime() - this.hide_delay_start_time) / 1000.0 > this.HIDE_DELAY) {
            if (this.setVisibleCallback) {
                this.setVisibleCallback(false);
            }
            this.hide_delay_start_time = -1;
        }
    }

    async _updateCurrentSource(): Promise<boolean> {
        
        let message = new dbus.Message({
            destination: "org.freedesktop.DBus",
            path: "/org/freedesktop/DBus",
            interface: "org.freedesktop.DBus",
            member: "ListNames"
        });

        let reply = await bus.call(message);
        let available_sources: string[] = [];

        for (let bus of reply.body[0]) {
            if (!bus.startsWith("org.mpris.MediaPlayer2.")) {
                continue;
            }

            bus = bus.slice(23, bus.length);

            if ("source_blacklist" in this._config) {
                let blacklisted = false;
                for (let player of this._config.source_blacklist) {
                    if (matchRuleShort(bus, player)) {
                        blacklisted = true;
                        break;
                    }
                }
                if (blacklisted) {
                    continue;
                }
            }

            available_sources.push(bus);
        }

        let new_sources: Source[] = [];
        let current_exists = false;

        for (let source_id of available_sources) {
            
            if (source_id.trim().length == 0) {
                continue;
            }

            let existing_source: Source | null = null;
            for (const source of this.sources) {
                if (source.id == source_id) {
                    existing_source = source;
                    break;
                }
            }

            if (existing_source) {
                if (!existing_source.isTitleBlacklisted(this)) {
                    new_sources.push(existing_source);
                    if (existing_source == this.current_source) {
                        current_exists = true;
                    }
                }
            }
            else {
                const source: Source | null = await Source.create(source_id, this);
                if (source) {
                    new_sources.push(source);
                }
            }
        }

        this.sources = new_sources;

        let changed = this.current_source != null;

        if (!current_exists) {
            this.current_source = null;
        }

        if (this.sources.length == 0) {
            this.current_source = null;
            return changed;
        }

        let original_source: Source | null = this.current_source;
        this.current_source = null;

        for (let i = 0; i < this.sources.length; i++) {
            let source: Source = this.sources[i];
            
            if (await source.getStatus() != 2) {
                continue;
            }

            if (this.current_source && this.current_source.last_activity >= source.last_activity) {
                continue;
            }
            
            this.current_source = source;
        }

        if (this.current_source == null) {
            for (let i = 0; i < this.sources.length; i++) {
                let source: Source = this.sources[i];

                if (source.last_activity < 0) {
                    continue;
                }

                if (this.current_source && this.current_source.last_activity >= source.last_activity) {
                    continue;
                }
                
                this.current_source = source;
            }
        }

        this.current_source?.updateLastActivity();

        return this.current_source != original_source;
    }

    // Returns true if the playing media name changed
    async update(): Promise<boolean> {

        if (this._config == null) {
            await this.loadConfig();

            if (this._config == null) {
                return false;
            }
        }

        if (this.setVolumeCallback) {
            const [volume, on] = await this.getVolumeData();
            this.setVolumeCallback(volume, !on);
        }

        let changed: boolean = await this._updateCurrentSource() || this._first_update;
        this._first_update = false;
        
        if (changed) {
            this.currentTitleScroll = 0;
        }

        if (this.current_source == null) {
            if (changed) {
                this.beginHide();
            }
            this.processHide();
            return changed;
        }

        this.current_source.updateMetadata();

        if (this.setCanGoNextCallback) {
            this.setCanGoNextCallback(await this.current_source.getProperty("Player", "CanGoNext"));
        }

        if (this.setCanGoPreviousCallback) {
            this.setCanGoPreviousCallback(await this.current_source.getProperty("Player", "CanGoPrevious"));
        }

        if (this.setPlayingCallback) {
            this.setPlayingCallback(await this.current_source.getStatus() == 2);
        }

        if (this.setTitleCallback) {
            const title: string = this.current_source.getReadableTitle(this);
            let set_title: string = "";

            if (this.MAX_TITLE_LENGTH > 0 && title.length > this.MAX_TITLE_LENGTH) {
                set_title = title.slice(this.currentTitleScroll, Math.min(this.currentTitleScroll + this.MAX_TITLE_LENGTH, title.length));
                
                if (set_title.length < this.MAX_TITLE_LENGTH) {
                    set_title += "   | " + title.slice(0, this.MAX_TITLE_LENGTH - set_title.length);
                }
                
                this.currentTitleScroll = (this.currentTitleScroll + 1) % title.length;
            }
            else {
                set_title = title;
            }

            this.setTitleCallback(set_title);
        }
        
        if (this.setVisibleCallback) {
            this.setVisibleCallback(true);
        }
        
        this.cancelHide();

        return changed;
    }

    async mediaForward() {
        (await this.current_source?.getPlayerIface()).Next();
        this.update();
    }

    async mediaBackward() {
        (await this.current_source?.getPlayerIface()).Previous();
        this.update();
    }

    async mediaPlayPause() {
        (await this.current_source?.getPlayerIface()).PlayPause();
        this.update();
    }

    async getVolumeData(offset: number = 0): Promise<[number, boolean]> {
        let data: string;
        try {
            data = (await this.cmd(["amixer", "get", "Master", "|", "grep", "'Right: '"]))[0];
        } catch {
            data = (await this.cmd(["amixer", "get", "Master", "|", "grep", "'Mono: '"]))[0];
        }

        let volume: number = Number(data.slice(data.indexOf("[") + 1, data.indexOf("]") - 1));
        volume = Math.max(0, Math.min(100, volume + offset));

        let on: boolean = data.slice(data.lastIndexOf("[") + 1, data.lastIndexOf("]")) == "on";

        return [volume, on];
    }

    setVolume(value: number) {
        return this.cmd(["amixer", "set", "Master", `${value}%`]);
    }
}

export class Source {

    metadata: any = {
        trackid: null,
        length: null,
        artUrl: null,
        album: null,
        albumArtist: null,
        artist: null,
        asText: null,
        audioBPM: null,
        autoRating: null,
        comment: null,
        composer: null,
        contentCreated: null,
        discNumber: null,
        firstUsed: null,
        genre: null,
        lastUsed: null,
        lyricist: null,
        title: null,
        trackNumber: null,
        url: null,
        useCount: null,
        userRating: null,
    };

    last_activity: number = -1;

    api: MediaAPI;
    id: string;

    properties_iface: any = null;
    player_iface: any = null;
    
    constructor(api: MediaAPI, id: string) {
        this.api = api;
        this.id = id;
    }

    async getPropertiesIface(): Promise<any> {
        if (this.properties_iface == null) {
            const obj = await bus.getProxyObject("org.mpris.MediaPlayer2." + this.id, "/org/mpris/MediaPlayer2");
            this.properties_iface = obj.getInterface("org.freedesktop.DBus.Properties")
        }
        return this.properties_iface;
    }

    async getPlayerIface(): Promise<any> {
        if (this.player_iface == null) {
            const obj = await bus.getProxyObject("org.mpris.MediaPlayer2." + this.id, "/org/mpris/MediaPlayer2");
            this.player_iface = obj.getInterface("org.mpris.MediaPlayer2.Player")
        }
        return this.player_iface;
    }

    async getProperty(iface: string, key: string): Promise<any> {
        if (iface != "") {
            iface = "." + iface;
        }
        const properties = await this.getPropertiesIface();
        return (await properties.Get("org.mpris.MediaPlayer2" + iface, key)).value;
    }

    async getStatus(): Promise<number> {
        switch (await this.getProperty("Player", "PlaybackStatus")) {
            case "Playing": return 2;
            case "Paused": return 1;
            default: return 0;
        }
    }

    updateLastActivity() {
        this.last_activity = getCurrentTime();
    }

    async updateMetadata() {
        const metadata: any = await this.getProperty("Player", "Metadata");
        for (let key of Object.keys(metadata)){
            const formatted_key = key.split(":", 2)[1];
            if (!(formatted_key in this.metadata)) {
                console.log("Unknown metadata key: " + key)
                continue;
            }
            this.metadata[formatted_key] = metadata[key]["value"];
        }
    }

    async toString(api: MediaAPI | null = null): Promise<string> {
        let ret: string = `${this.metadata.title}\n - Status: ${["Stopped", "Paused", "Playing"][await this.getStatus()]}\n - Last active: ${this.last_activity}\n - ID: ${this.id}`;
        if (api) {
            ret += "\n - Current: " + (api.current_source == this).toString();
        }
        return ret;
    }

    async formatTitle(api: MediaAPI) {

        const url: string = this.metadata["url"];

        if (this.id == "vlc" && url != null && this.metadata.title == "audio stream" && "dlna_command" in api._config) {

            if (url in api.vlc_dlna_cache) {
                this.metadata.title = api.vlc_dlna_cache[url];
            }
            else if (url.startsWith("http://")) {
                let ip = removePrefix(url, "http://").split("/", 1)[0];

                let available_servers = JSON.parse((await api.cmd([api._config.dlna_command, "list-servers"]))[0]);
                let server: string | null = null;

                for (let i = 0; i < available_servers.length; i++) {
                    if (removePrefix(available_servers[i].path, "http://").split("/", 1)[0] == ip) {
                        server = available_servers[i].path;
                        break;
                    }
                }

                if (server != null) {
                    let data = JSON.parse((await api.cmd([api._config.dlna_command, "search", "-s", server, "-sq", url, "-st", "path"]))[0]);
                    if (data.length > 0) {
                        this.metadata.title = data[0].name;
                        api.vlc_dlna_cache[url] = data[0].name;
                    }
                }
            }
        }

        let title: string = this.metadata.title!;

        title = removePrefix(title, "\"");	
        title = removeSuffix(title, "\"");
        title = replaceAll(title, "_", " ");
        title = replaceAll(title, "  ", " ");
        title = replaceAll(title, "\\\"", "\"");

        const extensionIndex = title.lastIndexOf(".");
        const extension = title.slice(extensionIndex + 1);
        if (!extension.includes(" ")) {
            title = title.slice(0, extensionIndex);
        }

        this.metadata.title = title.trim();
    }

    isTitleBlacklisted(api: MediaAPI) {
        if ("keyword_blacklist" in api._config) {
            const lower_name = this.metadata.title.toLowerCase();
            for (var j = 0; j < api._config.keyword_blacklist.length; j++) {
                if (lower_name.includes(api._config.keyword_blacklist[j].toLowerCase())) {
                    return true;
                }
            }
        }
        return false;
    }

    getReadableTitle(api: MediaAPI): string {
        let ret: string = this.metadata.title;
        
        if ("title_replacements" in api._config && ret in api._config.title_replacements) {
            return api._config.title_replacements[ret].trim();
        }

        if ("remove_brackets" in api._config) {
            for (const pair of api._config.remove_brackets) {
                let finished = false;
                while (!finished) {
                    const a = ret.indexOf(pair[0]);
                    if (a < 0) {
                        finished = true;
                        break;
                    }

                    const b = ret.indexOf(pair[1]);
                    if (b < 0) {
                        finished = true;
                        break;
                    }

                    const temp = ret;
                    ret = temp.slice(0, a - 1) + temp.slice(b + pair[1].length, temp.length);
                }
            }
        }

        if ("substring_replacements" in api._config) {
            for (var key of Object.keys(api._config.substring_replacements)) {
                ret = replaceAll(ret, key, api._config.substring_replacements[key]);
            }
        }

        if (this.metadata.artist != null) {
            ret = this.metadata.artist + " | " + ret;
        }

        return ret.trim();
    }

    static async create(source_id: string, api: MediaAPI): Promise<Source | null> {

        let source: Source = new Source(api, source_id);
        await source.updateMetadata();

        if ("artist_blacklist" in api._config && source.metadata.artist != null) {
            for (const artist of source.metadata.artist) {
                for (const blacklisted_artist of api._config.artist_blacklist) {
                    if (matchRuleShort(artist, blacklisted_artist)) {
                        return null;
                    }
                }
            }
        }

        if (source.isTitleBlacklisted(api)) {
            return null;
        }

        return source;
    }
}