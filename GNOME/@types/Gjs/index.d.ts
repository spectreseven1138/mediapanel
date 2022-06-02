declare global {
    function print(...args: any[]): void;
    function printerr(...args: any[]): void;
    function log(message?: string): void;
    function logError(exception: any, message?: string): void;
    const ARGV: string[];
    const imports: typeof Gjs & {
        [key: string]: any;
        gi: {
            Gtk: typeof Gtk;
            Gdk: typeof Gdk;
            Pango: typeof Pango;
            GLib: typeof GLib;
            Graphene: typeof Graphene;
            Clutter: typeof Clutter;
            ClutterX11: typeof ClutterX11;
            Meta: typeof Meta;
            Shell: typeof Shell;
            St: typeof St;
            xlib: typeof xlib;
            cairo: typeof cairo;
            HarfBuzz: typeof HarfBuzz;
            GObject: typeof GObject;
            Gio: typeof Gio;
            GdkPixbuf: typeof GdkPixbuf;
            Atk: typeof Atk;
            GModule: typeof GModule;
            Json: typeof Json;
            GL: typeof GL;
            CoglPango: typeof CoglPango;
            Cogl: typeof Cogl;
            PangoCairo: typeof PangoCairo;
            xfixes: typeof xfixes;
            GDesktopEnums: typeof GDesktopEnums;
            Cally: typeof Cally;
            PolkitAgent: typeof PolkitAgent;
            NM: typeof NM;
            Gvc: typeof Gvc;
            Gcr: typeof Gcr;
            Polkit: typeof Polkit;
            Gck: typeof Gck;
        };
        searchPath: string[];
    };
}

export { imports };