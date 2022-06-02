import * as MediaPanel from "mediapanel";

let Panel: MediaPanel.Extension

export function init() {
    Panel = new MediaPanel.Extension;
}

export function enable() {
    Panel.enable()
}

export function disable() {
    Panel.disable()
}
