export function removePrefix(text: string, prefix: string): string {
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
    while (text.includes(base)) {
        text = text.replace(base, replacement);
    }
    return text;
}

export function getCurrentTime(): number {
    return new Date().getTime();
}

export class MediaAPI {
    _cmd: (args: string[]) => Promise<string>;
    _load: (path: string) => Promise<string>;
    _save: (path: string, content: string) => void;

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
    setTitleCallback: ((title: string) => void) | null = null;
    setVolumeCallback: ((volume: number, muted: boolean) => void) | null = null;
    setPlayingCallback: ((playing: boolean) => void) | null = null;

    constructor(cmd_function: (args: string[]) => Promise<string>, load_function: (path: string) => Promise<string>, save_function: (path: string, content: string) => void) {
        this._cmd = cmd_function;
        this._load = load_function;
        this._save = save_function;
    }

    getConfigPath() {
        return "/.config/mediapanel-config.json";
    }

    async onConfigChanged() {
        this.sources = [];
        this.current_source = null;
        this.beginHide();
    }

    async loadConfig() {
        let original = this._config;
        try {
            this._config = JSON.parse(await this._load(this.getConfigPath()));
        }
        catch {
            this._config = original == null ? {} : original;
        }

        this.onConfigChanged();
    }

    async saveConfig() {
        this._save(this.getConfigPath(), JSON.stringify(this._config, null, 2));
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

        let new_sources: Source[] = [];
        const data: string[] = (await this._cmd(["pacmd", "list-sink-inputs"])).split("\n");

        let current_exists = false;

        let position = 0;
        while (position < data.length) {

            let line: string;

            while (position < data.length) {
                line = data[position].trim();
                if (line.startsWith("index:")) {
                    break;
                }
                position++;
            }

            if (position >= data.length) {
                break;
            }

            let index: number = Number(line!.slice(7));
            let existing_source: Source | null = null;

            for (let i = 0; i < this.sources.length; i++) {
                if (this.sources[i].index == index) {
                    existing_source = this.sources[i];
                    break;
                }
            }

            position++;

            if (existing_source) {

                while (position < data.length) {
                    line = data[position].trim();
                    if (line.startsWith("state:")) {
                        existing_source.playing = line.slice(7) == "RUNNING";
                        break;
                    }
                    position++;
                }

                if (position >= data.length) {
                    break;
                }

                while (position < data.length) {
                    line = data[position].trim();
                    if (line.startsWith("media.name")) {
                        existing_source.title = line.slice(13);
                        existing_source.formatTitle(this);

                        if (!existing_source.isTitleBlacklisted(this)) {
                            new_sources.push(existing_source);
                            if (existing_source == this.current_source) {
                                current_exists = true;
                            }
                        }

                        break;
                    }
                    position++;
                }

                if (position >= data.length) {
                    break;
                }
            }
            else {
                const [pos, source] = await Source.create(data, position, index, this);
                position = pos;
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
            
            if (!source.playing) {
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
            if (changed && this.setVisibleCallback) {
                this.beginHide();
            }
            this.processHide();
            return changed;
        }

        if (this.setPlayingCallback) {
            this.setPlayingCallback(this.current_source.playing);
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

    async mediaForward(player: string | null = this.current_source?.player!) {
        if (player) {
            await this._cmd(["playerctl", "next", "--player=" + player]);
        }
        else {
            await this._cmd(["playerctl", "next"]);
        }
        this.update();
    }

    async mediaBackward(player: string | null = this.current_source?.player!) {
        if (player) {
            await this._cmd(["playerctl", "previous", "--player=" + player]);
        }
        else {
            await this._cmd(["playerctl", "previous"]);
        }
        this.update();
    }

    async mediaPlayPause(player: string | null = this.current_source?.player!) {
        if (player) {
            await this._cmd(["playerctl", "play-pause", "--player=" + player]);
        }
        else {
            await this._cmd(["playerctl", "play-pause"]);
        }
        this.update();
    }

    async getVolumeData(offset: number = 0): Promise<[number, boolean]> {
        let data: string;
        try {
            data = await this._cmd(["amixer", "get", "Master", "|", "grep", "'Right: '"]);
        } catch {
            data = await this._cmd(["amixer", "get", "Master", "|", "grep", "'Mono: '"]);
        }

        let volume: number = Number(data.slice(data.indexOf("[") + 1, data.indexOf("]") - 1));
        volume = Math.max(0, Math.min(100, volume + offset));

        let on: boolean = data.slice(data.lastIndexOf("[") + 1, data.lastIndexOf("]")) == "on";

        return [volume, on];
    }

    setVolume(value: number) {
        return this._cmd(["amixer", "set", "Master", `${value}%`]);
    }
}

export class Source {

    title: string = "undefined";
    player: string = "undefined";
    playing: boolean = false;
    index: number;
    last_activity: number = -1;

    api: any;

    constructor(index: number) {
        this.index = index;
    }

    updateLastActivity() {
        this.last_activity = getCurrentTime();
    }

    toString(api: MediaAPI | null = null): string {
        let ret: string = `${this.title}\n - Playing: ${this.playing}\n - Last active: ${this.last_activity}\n - Index: ${this.index}`;
        if (api) {
            ret += "\n - Current: " + (api.current_source == this).toString();
        }
        return ret;
    }

    async formatTitle(api: MediaAPI) {
        if (this.player == "vlc" && this.title == "audio stream" && "dlna_command" in api._config) {

            let url: string = await api._cmd(["playerctl", "metadata", "--format", "\"{{ xeasam:url }}\""]);

            if (url in api.vlc_dlna_cache) {
                this.title = api.vlc_dlna_cache[url];
            }
            else if (url.startsWith("http://")) {
                let ip = removePrefix(url, "http://").split("/", 1)[0];

                let available_servers = JSON.parse(await api._cmd([api._config.dlna_command, "list-servers"]));
                let server: string | null = null;

                for (let i = 0; i < available_servers.length; i++) {
                    if (removePrefix(available_servers[i].path, "http://").split("/", 1)[0] == ip) {
                        server = available_servers[i].path;
                        break;
                    }
                }

                if (server != null) {
                    let data = JSON.parse(await api._cmd([api._config.dlna_command, "search", "-s", server, "-sq", url, "-st", "path"]));
                    if (data.length > 0) {
                        this.title = data[0].name;
                        api.vlc_dlna_cache[url] = data[0].name;
                    }
                }
            }
        }

        let title: string = this.title!;

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

        this.title = title.trim();
    }

    isTitleBlacklisted(api: MediaAPI) {
        if ("keyword_blacklist" in api._config) {
            const lower_name = this.title.toLowerCase();
            for (var j = 0; j < api._config.keyword_blacklist.length; j++) {
                if (lower_name.includes(api._config.keyword_blacklist[j].toLowerCase())) {
                    return true;
                }
            }
        }
        return false;
    }

    getReadableTitle(api: MediaAPI): string {
        if ("title_replacements" in api._config && this.title in api._config.title_replacements) {
            return api._config.title_replacements[this.title].trim();
        }

        let ret: string = this.title;

        if ("substring_replacements" in api._config) {
            for (var key of Object.keys(api._config.substring_replacements)) {
                ret = ret.replace(key, api._config.substring_replacements[key]);
            }
        }
        
        return ret.trim();
    }

    // Should be called when 'position' is on the line after the source's index
    static async create(source_data: string[], position: number, index: number, api: MediaAPI): Promise<[number, Source | null]> {
        
        let source: Source = new Source(index);
        source.api = api;

        for (; position < source_data.length; position++) {
            const line = source_data[position].trim();
            let split: string[];

            if (line.includes(" = ")) {
                split = line.split(" = ");
            }
            else {
                split = line.split(": ");
            }
        
            if (split.length == 1)
                continue;
        
            const key = split[0];
            const value = removeSuffix(removePrefix(split[1].trim(), "\""), "\"");
        
            if (key == "index") {
                break;
            }

            if (key == "driver") {
                if (value != "<protocol-native.c>") {
                    return [position + 1, null];
                }
                continue;
            }
            
            if (key == "state") {
                source.playing = value == "RUNNING";
                continue;
            }

            if (key == "media.name") {
                source.title = value;
                continue;
            }	
            
            if (key == "application.process.binary") {
                source.player = value;

                if ("player_blacklist" in api._config && api._config.player_blacklist.includes(value)) {
                    return [position + 1, null];
                }

                if ("artist_blacklist" in api._config && api._config.artist_blacklist.includes(await api._cmd(["playerctl", "metadata", "--format", "\"{{ artist }}\"", "--player=" + value]))) {
                    return [position + 1, null];
                }

                continue;
            }
        }

        source.formatTitle(api);

        if (source.isTitleBlacklisted(api)) {
            return [position + 1, null];
        }

        return [position, source];
    }
}