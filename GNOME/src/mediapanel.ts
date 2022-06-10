const St = imports.gi.St;
const Gio = imports.gi.Gio;
// const Gtk = imports.gi.Gtk;
const GLib = imports.gi.GLib;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const Clutter = imports.gi.Clutter;

import * as API from "mediaAPI";

function cmd(args: Array<string>, raise_error: boolean = true): Promise<[string, boolean]> {
    let proc = new Gio.Subprocess({
        argv: args,
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
    });
    
    proc.init(null);

    return new Promise((resolve) => {
        proc.communicate_utf8_async(null, null, (source_object: any, res: Gio.AsyncResult) => {
            let [, out, err] = source_object.communicate_utf8_finish(res);
            if (proc.get_successful()) {
                resolve([out.trim(), true]);
            }
            else if (raise_error) {
                throw EvalError(err.trim());
            }
            else {
                resolve([err.trim(), false]);
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

    widget: typeof PanelMenu;
    container: St.BoxLayout | null = null;
    mainLabel: St.Label | null = null;
    buttonPlayPauseIcon: St.Icon | null = null;
    api: API.MediaAPI | null = null;
    loop: number = -1;

    buttonNext: St.Button | null = null;
    buttonPrevious: St.Button | null = null;

    indicatorName = Me.metadata.name.replace(" ", "-");
    currentPanel: any = null;

    enable() {
        log(`Enabling ${Me.metadata.name}`);

        this.api = new API.MediaAPI(cmd, load, save, log);
        
        this.widget = new PanelMenu.Button(0.0, this.indicatorName, false);
        this.widget.setSensitive(false);

        this.container = new St.BoxLayout({
            x_expand: true, y_expand: false
        });
        this.widget.add_child(this.container);

        let buttonMain = new St.Button();
        buttonMain.y_align = Clutter.ActorAlign.CENTER;
        buttonMain.x_align = Clutter.ActorAlign.CENTER;
        this.container.add_child(buttonMain);

        buttonMain.connect("button-release-event", (_obj, event) => {

            // @ts-expect-error
            let button: number = event.get_button();

            // Left click
            if (button == 1) {

            }

            // Right click
            else if (button == 3) {
                this.api?.loadConfig((msg: string) => {
                    cmd(["notify-send", "MediaPanel", msg]);
                });
            }
            
            // Middle click
            else if (button == 2) {
                cmd(["code", API.removePrefix(this.api?.getConfigPath()!, "/")]);
            }

            return Clutter.EVENT_PROPAGATE;
        });

        this.mainLabel = new St.Label({
            style_class: "playback-label"
        });
        buttonMain.set_child(this.mainLabel);

        // -------------------------------
        
        this.buttonPrevious = new St.Button({
            style_class: "playback-button"
        });
        this.container.add_child(this.buttonPrevious);

        this.buttonPrevious.connect("button-release-event", () => {
            this.api?.mediaBackward();
        });

        let icon = new St.Icon({
            gicon: new Gio.ThemedIcon({name: "media-skip-backward-symbolic"}),
            style_class: 'system-status-icon'
        });
        this.buttonPrevious.set_child(icon);

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


        this.buttonNext = new St.Button({
            style_class: "playback-button"
        });
        this.container.add_child(this.buttonNext);

        this.buttonNext.connect("button-release-event", () => {
            this.api?.mediaForward();
        });

        icon = new St.Icon({
            gicon: new Gio.ThemedIcon({name: "media-skip-forward-symbolic"}),
            style_class: 'system-status-icon'
        });
        this.buttonNext.set_child(icon);

        this.updateWidgetPosition();

        this.bindAPI();

        this.loop = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, this.update_interval, this.update.bind(this)
        );
    }

    bindAPI() {
        this.api!.setVisibleCallback = (visible: boolean) => {
            visible ? this.container?.show() : this.container?.hide();
        }

        this.api!.setCanGoNextCallback = (can_go: boolean) => {
            can_go ? this.buttonNext?.show() : this.buttonNext?.hide();
        }

        this.api!.setCanGoPreviousCallback = (can_go: boolean) => {
            can_go ? this.buttonPrevious?.show() : this.buttonPrevious?.hide();
        }

        this.api!.setTitleCallback = (title: string) => {
            this.mainLabel?.set_text(title);
        }

        this.api!.setPlayingCallback = (playing: boolean) => {
            this.buttonPlayPauseIcon?.set_gicon(new Gio.ThemedIcon({name: playing ? "media-playback-pause-symbolic" : "media-playback-start-symbolic"}))
        }

        this.api!._log = log;
    }

    disable() {
        log(`Disabling ${Me.metadata.name}`);
        this.widget.destroy();
        this.widget = null;

        GLib.Source.remove(this.loop);
        this.loop = -1;
    }

    updateWidgetPosition() {
        //@ts-expect-error
        const dtp = global.dashToPanel;
        if (dtp) {
            let fallback_panel: any = null;

            for (const panel of dtp.panels) {
                if (panel.monitor.inFullscreen) {
                    continue;
                }

                if (panel.monitor.index == Main.layoutManager.primaryMonitor.index) {
                    this.addWidgetToPanel(panel);
                    return;
                }
                else {
                    fallback_panel = panel;
                }
            }

            if (fallback_panel) {
                this.addWidgetToPanel(fallback_panel);
                return;
            }
        }
        else {
            this.addWidgetToPanel(Main.Panel);
        }            
    }

    addWidgetToPanel(panel: any) {
        if (panel == this.currentPanel) {
            return;
        }

        if (this.currentPanel) {
            this.widget.container.get_parent().remove_child(this.widget.container);
            delete this.currentPanel.statusArea[this.indicatorName];
        }

        panel.panel.addToStatusArea(this.indicatorName, this.widget, 0, "center");
        this.currentPanel = panel;
    }

    update(): boolean {
        this.updateWidgetPosition();
        this.api?.update().then(null, (reason: Error) => {
            log(reason.name);
            log(reason.message);
            log(reason.stack || "No stack provided");
            this.mainLabel?.set_text("ERR: " + reason.toString());
            throw reason;
        });

        return GLib.SOURCE_CONTINUE;
    }
};
