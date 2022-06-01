
function removePrefix(text: string, prefix: string): string {
    if (prefix.length > text.length)
        return text;
    if (text.indexOf(prefix) == 0) {
        return text.slice(prefix.length);
    }
    return text;
}

function removeSuffix(text: string, suffix: string): string {
    if (suffix.length > text.length)
        return text;
    if (text.lastIndexOf(suffix) == text.length - suffix.length) {
        return text.slice(0, text.length - suffix.length);
    }
    return text;
}

function replaceAll(text: string, base: string, replacement: string) {
    while (text.includes(base)) {
        text = text.replace(base, replacement);
    }
    return text;
}

export class MediaAPI {
    _cmd: (args: string[]) => Promise<string>;
    _load: (path: string) => Promise<string>;
    _save: (path: string, content: string) => void;

    _config_path: string | null = null;
    config: any = null;

    playingMedia: string | null = "";
    playerName: string = "";
    paused: boolean = false;
    currentTitleScroll: number = 0;

    active_media_names: Array<string> = [];
    vlc_dlna_cache: any = {};

    maxTitleLength: number = -1;

    setVisibleCallback: ((visible: boolean) => void) | null = null;
    setTitleCallback: ((title: string) => void) | null = null;
    setVolumeCallback: ((volume: number, muted: boolean) => void) | null = null;
    setPausedCallback: ((paused: boolean) => void) | null = null;

    constructor(cmd_function: (args: string[]) => Promise<string>, load_function: (path: string) => Promise<string>, save_function: (path: string, content: string) => void) {
        this._cmd = cmd_function;
        this._load = load_function;
        this._save = save_function;
    }

    async getConfigPath(): Promise<string> {
        if (this._config_path != null) {
            return this._config_path;
        }
        this._config_path = (await this._cmd(["echo $HOME"])).trimEnd() + "/.config/vscode-mediapanel.json";
        return this._config_path;
    }

    async loadConfig() {
        this.config = JSON.parse(await this._load(await this.getConfigPath()));
    }

    async saveConfig() {
        this._save(await this.getConfigPath(), JSON.stringify(this.config, null, 2));
    }

    getReadableMediaName(name: string): string {
        if ("title_replacements" in this.config && name in this.config.title_replacements) {
            return this.config.title_replacements[name].trim();
        }

        if ("substring_replacements" in this.config) {
            for (var key of Object.keys(this.config.substring_replacements)) {
                name = name.replace(key, this.config.substring_replacements[key]);
            }
        }
        
        return name.trim();
    }

    formatMediaName(name: string): string {
        if (this.playerName == "vlc" && name == "audio stream" && "dlna_command" in this.config) {

            this._cmd(["playerctl", "metadata", "--format", "\"{{ xeasam:url }}\""]).then(url => {
                if (url in this.vlc_dlna_cache) {
                    name = this.vlc_dlna_cache[url];
                }
                else if (url.startsWith("http://")) {
                    let ip = removePrefix(url, "http://").split("/", 1)[0];

                    this._cmd([this.config.dlna_command, "list-servers"]).then(servers => {
                        let available_servers = JSON.parse(servers);
                        let server: string | null = null;

                        for (let i = 0; i < available_servers.length; i++) {
                            if (removePrefix(available_servers[i].path, "http://").split("/", 1)[0] == ip) {
                                server = available_servers[i].path;
                                break;
                            }
                        }

                        if (server != null) {
                            this._cmd([this.config.dlna_command, "search", "-s", server, "-sq", url, "-st", "path"]).then(path => {
                                let data = JSON.parse(path);
                                if (data.length > 0) {
                                    name = data[0].name;
                                    this.vlc_dlna_cache[url] = data[0].name;
                                }
                            })
                        }
                    });
                }
            })
        }

        name = removePrefix(name, "\"");	
        name = removeSuffix(name, "\"");
        name = replaceAll(name, "_", " ");
        name = replaceAll(name, "  ", " ");
        name = replaceAll(name, "\\\"", "\"");

        const extensionIndex = name.lastIndexOf(".");
        const extension = name.slice(extensionIndex + 1);
        if (!extension.includes(" ")) {
            name = name.slice(0, extensionIndex);
        }

        return name.trim();
    }

    // Returns true if the playing media name changed
    async update(): Promise<boolean> {

        if (this.config == null) {
            await this.loadConfig();
        }

        const mediaData = (await this._cmd(["pacmd", "list-sink-inputs"])).split("\n");
        let running = false;
        let skip = false;	
        let mediaName: string | null = null;
        let altMediaName: string | null = null;
        
        this.paused = false;
        
        for (let i = 1; i < mediaData.length; i++){
            
            const line = mediaData[i].trim();
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

            if (skip) {
                if (key == "index")
                    skip = false;
                continue;
            }
        
            if (key == "driver" && value != "<protocol-native.c>") {
                skip = true;
                continue;
            }
            
            if (key == "state" && value == "RUNNING") {
                running = true;
                continue;
            }
        
            if (!running) {
                if (key == "media.name") {
                    let formatted: string = this.formatMediaName(value);
                    if (formatted === this.playingMedia || this.active_media_names.includes(formatted)) {
                        mediaName = this.playingMedia;
                        this.paused = true;
                    }
                }
                continue;
            }

            if (key == "index") {
                break;
            }

            if (key == "media.name") {

                let formatted: string = this.formatMediaName(value);
                if (this.active_media_names.findIndex(name => {name == formatted}) >= 0) {
                    mediaName = formatted;
                    altMediaName = formatted;
                    this.paused = false;
                }
                else {

                    if ("keyword_blacklist" in this.config) {
                        let blacklisted = false;
                        const lower_name = value.toLowerCase();

                        for (var j = 0; j < this.config.keyword_blacklist.length; j++) {
                            if (lower_name.includes(this.config.keyword_blacklist[j].toLowerCase())) {
                                blacklisted = true;
                                break;
                            }
                        }

                        if (blacklisted) {
                            mediaName = null;
                            running = false;
                            this.playerName = "";
                            continue;
                        }
                    }

                    mediaName = formatted;
                    this.active_media_names.push(formatted)
                    this.paused = false;
                }
            }	
            
            if (key == "application.process.binary") {
                if (
                    ("player_blacklist" in this.config && this.config.player_blacklist.includes(value)) || 
                    ("artist_blacklist" in this.config && this.config.artist_blacklist.includes(await this._cmd(["playerctl", "metadata", "--format", "\"{{ artist }}\"", "--player=" + value]))) ) {
                    mediaName = null;
                    running = false;
                    this.playerName = "";
                    continue;
                }
                this.playerName = value;
            }
        }
        if (mediaName == null) {
            mediaName = altMediaName;
        }

        let changed = this.playingMedia != "" && this.playingMedia != mediaName;

        if (this.playingMedia == null) {
            if (this.setVisibleCallback) {
                this.setVisibleCallback(false);
            }
        }
        else {
            if (this.setTitleCallback) {
                const title: string = this.getReadableMediaName(this.playingMedia);
                let set_title: string = "";

                if (this.maxTitleLength > 0 && title.length > this.maxTitleLength) {
                    set_title = title.slice(this.currentTitleScroll, Math.min(this.currentTitleScroll + this.maxTitleLength, title.length));
                    
                    if (set_title.length < this.maxTitleLength) {
                        set_title += "   | " + title.slice(0, this.maxTitleLength - set_title.length);
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
        }

        if (this.setVolumeCallback) {
            const [volume, on] = await this.getVolumeData();
            this.setVolumeCallback(volume, !on);
        }

        if (this.setPausedCallback) {
            this.setPausedCallback(this.paused);
        }
        
        this.playingMedia = mediaName;
        return changed;
    }

    async mediaForward(player: string | null = this.playerName) {
        if (player) {
            return await this._cmd(["playerctl", "next", "--player=" + player]);
        }
        else {
            return await this._cmd(["playerctl", "next"]);
        }
    }

    async mediaBackward(player: string | null = this.playerName) {
        if (player) {
            return await this._cmd(["playerctl", "previous", "--player=" + player]);
        }
        else {
            return await this._cmd(["playerctl", "previous"]);
        }
    }

    async mediaPlayPause(player: string | null = this.playerName) {
        if (player) {
            return await this._cmd(["playerctl", "play-pause", "--player=" + player]);
        }
        else {
            return await this._cmd(["playerctl", "play-pause"]);
        }
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