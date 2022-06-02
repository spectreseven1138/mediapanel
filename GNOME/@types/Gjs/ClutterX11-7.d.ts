/**
 * ClutterX11-7
 */

/// <reference path="Gjs.d.ts" />
/// <reference path="xlib-2.0.d.ts" />
/// <reference path="CoglPango-7.d.ts" />
/// <reference path="PangoCairo-1.0.d.ts" />
/// <reference path="cairo-1.0.d.ts" />
/// <reference path="Pango-1.0.d.ts" />
/// <reference path="HarfBuzz-0.0.d.ts" />
/// <reference path="GObject-2.0.d.ts" />
/// <reference path="GLib-2.0.d.ts" />
/// <reference path="Cogl-7.d.ts" />
/// <reference path="Graphene-1.0.d.ts" />
/// <reference path="GL-1.0.d.ts" />
/// <reference path="Clutter-7.d.ts" />
/// <reference path="Json-1.0.d.ts" />
/// <reference path="Gio-2.0.d.ts" />
/// <reference path="Atk-1.0.d.ts" />

declare namespace ClutterX11 {

export enum FilterReturn {
    CONTINUE,
    TRANSLATE,
    REMOVE,
}
export function get_default_display(): xlib.Display
export function get_default_screen(): number
export function get_use_stereo_stage(): boolean
export function set_display(xdpy: xlib.Display): void
export function set_use_stereo_stage(use_stereo: boolean): void
export function trap_x_errors(): void
export function untrap_x_errors(): number
export interface FilterFunc {
    (xev: xlib.XEvent, cev: Clutter.Event): FilterReturn
}
export class XInputDevice {
    static name: string
}
}