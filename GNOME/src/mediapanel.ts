const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const Clutter = imports.gi.Clutter;

import * as API from "mediaAPI";

function cmd(args: Array<string>): Promise<string> {
    let proc = new Gio.Subprocess({
        argv: args,
        flags: Gio.SubprocessFlags.STDOUT_PIPE
    });
    proc.init(null);
    return new Promise((resolve, reject) => {
        proc.communicate_utf8_async(null, null, (proc: any, res) => {
            try {
                resolve(proc.communicate_utf8_finish(res)[1]);
            } catch (e: any) {
                reject(e);
            }
        });
    });
}

function load(path: string): Promise<string> {
    let file = Gio.File.new_for_path(API.removePrefix(path, "/"));
    const [, contents] = file.load_contents(null);
    return new Promise(resolve => {
        resolve(imports.byteArray.toString(contents));
    })
}

async function save(path: string, content: string) {
    const file = Gio.File.new_for_path(API.removePrefix(path, "/"));
    file.replace_contents_bytes_async(
        imports.byteArray.fromString(content),
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null,
        (_file, result) => {
            file.replace_contents_finish(result);
        }
    );
}

export class Extension {

    update_interval: number = 1;

    panel: typeof PanelMenu;
    container: St.BoxLayout | null = null;
    mainLabel: St.Label | null = null;
    buttonPlayPauseIcon: St.Icon | null = null;
    api: API.MediaAPI | null = null;
    loop: number = -1;

    enable() {
        log(`Enabling ${Me.metadata.name}`);

        let indicatorName = Me.metadata.name.replace(" ", "-");

        this.api = new API.MediaAPI(cmd, load, save);
        
        this.panel = new PanelMenu.Button(0.0, indicatorName, false);
        this.panel.setSensitive(false);

        this.container = new St.BoxLayout({
            x_expand: true, y_expand: false
        });
        this.panel.add_child(this.container);

        this.mainLabel = new St.Label({
            text: "アイ情劣等生／かいりきベア【Kotone(天神子兎音)cover】",
            style_class: "playback-label"
        });
        this.mainLabel.y_align = Clutter.ActorAlign.CENTER;
        this.mainLabel.x_align = Clutter.ActorAlign.CENTER;
        this.container.add_child(this.mainLabel);

        // -------------------------------
        
        let buttonBack = new St.Button({
            style_class: "playback-button"
        });
        this.container.add_child(buttonBack);

        buttonBack.connect("button-release-event", () => {
            this.api?.mediaBackward();
        });

        let icon = new St.Icon({
            gicon: new Gio.ThemedIcon({name: "media-skip-backward-symbolic"}),
            style_class: 'system-status-icon'
        });
        buttonBack.set_child(icon);

        // -------------------------------

        let buttonPlayPause = new St.Button({
            style_class: "playback-button"
        });
        this.container.add_child(buttonPlayPause);

        buttonPlayPause.connect("button-release-event", () => {
            this.api?.mediaPlayPause();
        });

        this.buttonPlayPauseIcon = new St.Icon({
            gicon: new Gio.ThemedIcon({name: "media-playback-start-symbolic"}),
            style_class: 'system-status-icon'
        });
        buttonPlayPause.set_child(this.buttonPlayPauseIcon);


        // -------------------------------


        let buttonForward = new St.Button({
            style_class: "playback-button"
        });
        this.container.add_child(buttonForward);

        buttonForward.connect("button-release-event", () => {
            this.api?.mediaForward();
        });

        icon = new St.Icon({
            gicon: new Gio.ThemedIcon({name: "media-skip-forward-symbolic"}),
            style_class: 'system-status-icon'
        });
        buttonForward.set_child(icon);

        Main.panel.addToStatusArea(indicatorName, this.panel, 0, "center");

        this.bindAPI();

        this.loop = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, this.update_interval, this.update.bind(this)
        );
    }

    bindAPI() {
        this.api!.setVisibleCallback = (visible: boolean) => {
            visible ? this.container?.show() : this.container?.hide();
        }

        this.api!.setTitleCallback = (title: string) => {
            this.mainLabel?.set_text(title);
        }

        this.api!.setPlayingCallback = (playing: boolean) => {
            this.buttonPlayPauseIcon?.set_gicon(new Gio.ThemedIcon({name: playing ? "media-playback-pause-symbolic" : "media-playback-start-symbolic"}))
        }
    }

    disable() {
        log(`Disabling ${Me.metadata.name}`);
        this.panel.destroy();
        this.panel = null;

        GLib.Source.remove(this.loop);
        this.loop = -1;
    }

    update(): boolean {

        log("Update");
        this.api?.update().then(null, (reason: Error) => {
            this.mainLabel?.set_text("ERR: " + reason.toString());
            throw reason;
        });

        return GLib.SOURCE_CONTINUE;
    }
};
