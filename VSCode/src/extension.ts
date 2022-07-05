import * as vscode from 'vscode';
const child_process = require("child_process");

const enableVolumeControl = false;
const displayNowPlayingNotification = false;
const volumeStep = 3;
const statusBarHeight = 50;
const updateInterval = 1 * 1000;

let api_data: any = null;

let mediaItem: vscode.StatusBarItem;
let volumeItem: vscode.StatusBarItem;
let controlItem: vscode.StatusBarItem;
let nextItem: vscode.StatusBarItem;
let previousItem: vscode.StatusBarItem;
let soundBarItem: vscode.StatusBarItem;

let skipNotification = false;
let unmutedVolume: number = 0;
let windowPID: string | null = null;
let scrollEventMonitor: any = null;

const notify = vscode.window.showInformationMessage;

async function apiCall(command: string): Promise<string> {
	return cmd("mediaAPI client " + command);
}

const setVisibleCallback = (visible: boolean) => {
	if (visible) {
		mediaItem.show();
		controlItem.show();
		nextItem.show();
		previousItem.show();
	}
	else {
		mediaItem.hide();
		controlItem.hide();
		nextItem.hide();
		previousItem.hide();
	}
}

const setCanGoNextCallback = (can_go: boolean) => {
	nextItem.text = can_go ? ">" : "";
}

const setCanGoPreviousCallback = (can_go: boolean) => {
	previousItem.text = can_go ? "<" : "";
}

const setTitleCallback = (title: string) => {
	mediaItem.text = title;
}

const setVolumeCallback = (volume: number, muted: boolean) => {
	if (muted) {
		volumeItem.text = `$(mute) Muted`;
	}
	else {
		const icon = volume === 0 ? "mute" : "unmute";
		volumeItem.text = `$(${icon})  ${volume}%`;
	}
}

const setPlayingCallback = (playing: boolean) => {
	controlItem.text = `$(${playing ? "debug-pause" : "play"})`;
}

export async function activate({ subscriptions }: vscode.ExtensionContext) {
	
	const mediaCommandId = "mediaItem.mediaClicked"
	subscriptions.push(vscode.commands.registerCommand(mediaCommandId, onMediaItemClicked));

	const volumeCommandId = "mediaItem.volumeClicked"
	subscriptions.push(vscode.commands.registerCommand(volumeCommandId, onVolumeItemClicked));
	
	const controlCommandId = "mediaItem.controlClicked"
	subscriptions.push(vscode.commands.registerCommand(controlCommandId, onControlItemClicked));
	
	const nextCommandId = "mediaItem.nextClicked"
	subscriptions.push(vscode.commands.registerCommand(nextCommandId, onNextItemClicked));
	
	const previousCommandId = "mediaItem.previousClicked"
	subscriptions.push(vscode.commands.registerCommand(previousCommandId, onPreviousItemClicked));
	
	let alignment = 1000000000000000 - 10;
	
	volumeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, alignment++);
	volumeItem.command = volumeCommandId;
	volumeItem.show();
	
	nextItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, alignment++);
	nextItem.command = nextCommandId;
	nextItem.text = "";
	nextItem.show();
	
	controlItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, alignment++);
	controlItem.command = controlCommandId;
	controlItem.show();
	
	previousItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, alignment++);
	previousItem.command = previousCommandId;
	previousItem.text = "";
	previousItem.show();
	
	mediaItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, alignment++);
	mediaItem.command = mediaCommandId;
	mediaItem.show();
	
	soundBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, alignment++);
	soundBarItem.show();
	
	if (enableVolumeControl) {
		if (vscode.window.state.focused) {
			windowPID = await getFocusedWindowPID();
			scrollEventMonitor = child_process.exec(`xev -id ${windowPID}`);
			scrollEventMonitor.stdout?.on('data', onScrollMonitorSTDOUT);
		}
		else {
			subscriptions.push(vscode.window.onDidChangeWindowState(onWindowStateChanged));
		}
	}

	setInterval(mainLoop, updateInterval);
}

export function deactivate() {
	scrollEventMonitor?.kill("SIGKILL");
}

function mainLoop() {
	updateItems();
}

function cmd(command: string): Promise<string> {
	return new Promise((resolve) => {
		child_process.exec(command, (error: Error, stdout: string | Buffer) => {
			if (error) {
				throw error;
			}
			resolve(stdout.toString().trim());
		});
	});
}

async function onWindowStateChanged() {
	
	if (windowPID != null)
		return;
	
	if (vscode.window.state.focused) {
		windowPID = await getFocusedWindowPID();
		scrollEventMonitor = child_process.exec(`xev -id ${windowPID}`);
		scrollEventMonitor.stdout?.on('data', onScrollMonitorSTDOUT);
	}
}

async function onScrollMonitorSTDOUT(data: string) {
	
	if (windowPID == null)
		return;

	// Check data for scroll up/down inputs
	let up: boolean;
	if (data.includes(", state 2048")) {
		up = true;
	}
	else if (data.includes(", state 4096")) {
		up = false;
	}
	else {
		return;
	}

	// Get window geometry and mouse position data from xdotool
	const windowData = (await cmd(`xdotool getwidowgeometry --shell ${windowPID} getmouselocation --shell`)).split("\n");
	
	// Check if the mouse is inside the statusbar
	const windowY = Number(windowData[2].slice(2));
	const windowHeight = Number(windowData[4].slice(7));
	const mouseY = Number(windowData[7].slice(2));
	
	if (windowY + windowHeight - mouseY > statusBarHeight) {
		return;
	}
	
	const windowX = Number(windowData[1].slice(2));
	const windowWidth = Number(windowData[3].slice(6));
	const mouseX = Number(windowData[6].slice(2));
	
	if (mouseX < windowX || mouseX > windowX + windowWidth) {
		return;
	}

	// TODO
	return;

	// // Get the current volume level
	// let [volume] = await api.getVolumeData(volumeStep * (up ? 1 : -1));

	// // Apply increased / decreased volume
	// await cmd(`amixer set Master ${volume}%`);
	
	// const icon = volume == 0 ? "mute" : "unmute";
	// volumeItem.text = `$(${icon})  ${volume}%`;
}

async function updateItems() {

	api_data = JSON.parse(await apiCall("getinfo"));

    setVisibleCallback(api_data.visible);
    setCanGoNextCallback(api_data.can_go_next);
    setCanGoPreviousCallback(api_data.can_go_previous);
    setTitleCallback(api_data.title);
    setVolumeCallback(api_data.volume, api_data.muted);
    setPlayingCallback(api_data.playing);

	if (skipNotification) {
		skipNotification = false;
	}
	else if (displayNowPlayingNotification && api_data.visible) {
		notify("Now playing: " + api_data.title);
	}
}

async function onMediaItemClicked() {
	
	if (!api_data.visible) {
		return;
	}

	const artist: string = api_data.metadata.artist[0] || "Unknown";
	const actions: Map<string, Function> = new Map();
	
	// actions.set("Override title", overrideSongTitle);

	// TODO Move to API
	// if ("title_replacements" in api._config && api.current_source.metadata.title in api._config.title_replacements) {
	// 	actions.set("Clear title override", () => {
	// 		if ("title_replacements" in api._config && api.current_source && api.current_source.metadata.title in api._config.title_replacements) {
	// 			delete api._config.title_replacements[api.current_source.metadata.title];
	// 		}
	// 		api.saveConfig();
	// 		api.onConfigChanged();
	// 	});
	// }

	// actions.set("Blacklist player", () => {
	// 	if (!("player_blacklist" in api._config)) {
	// 		api._config.player_blacklist = [];
	// 	}
	// 	api._config.player_blacklist.push(api.current_source?.id);
	// 	api.saveConfig();
	// 	api.onConfigChanged();
	// });

	// actions.set("Blacklist artist", () => {
	// 	if (!("artist_blacklist" in api._config)) {
	// 		api._config.artist_blacklist = [];
	// 	}
	// 	api._config.artist_blacklist.push(artist);
	// 	api.saveConfig();
	// 	api.onConfigChanged();
	// });

	// actions.set("Blacklist keyword", () => {
	// 	vscode.window.showInputBox({
	// 		placeHolder: "Input the keyword to blacklist"
	// 	}).then((input: any) => {
	// 		if (input === undefined) {
	// 			return;
	// 		}
			
	// 		if (!("keyword_blacklist" in api._config)) {
	// 			api._config.keyword_blacklist = [input];
	// 		}
	// 		else {
	// 			api._config.keyword_blacklist.push(input);
	// 		}
	
	// 		api.saveConfig()
	// 		api.onConfigChanged();
	// 	})
	// });
	
	actions.set("Reload config", () => {
		apiCall("reloadconfig");
	})
	
	actions.set("Open config", async () => {
		const openPath = vscode.Uri.file(await cmd("mediaAPI config_path"));
		vscode.workspace.openTextDocument(openPath).then((doc: any) => {
			vscode.window.showTextDocument(doc);
		});
	})

	// actions.set("List sources", () => {
	// 	let detail: string = "";
	// 	api.sources.forEach((source: API.Source) => {
	// 		detail += "\n\n" + source.toString(api);
	// 	})
	// 	notify("Detected sources (excluding blacklisted):", {modal:true, detail: detail});
	// })

	let detail: string =
		"Artist: " + artist
		// + "\n" + "Player: " + api_data.
		// + "\n" + "Original title: " + api.current_source.metadata.title;
	
	notify(
		api_data.title + "\n", {modal: true, detail: detail}, 
		...Array.from(actions.keys()).reverse()).then((action: any) => {
		actions.get(action!)!();
	});
}

function overrideSongTitle(): void {

	if (!api_data.visible) {
		return;
	}

	// vscode.window.showInputBox({
	// 	placeHolder: "Input the title to replace '" + api.current_source.metadata.title + "'",
	// 	value: api.current_source.metadata.title
	// }).then((input: any) => {
	// 	if (input === undefined || api.current_source == null) {
	// 		return;
	// 	}
		
	// 	if (!("title_replacements" in api._config)) {
	// 		api._config.title_replacements = {};
	// 	}

	// 	api._config.title_replacements[api.current_source.metadata.title] = input;
	// 	api.saveConfig()
	// 	api.onConfigChanged();
	// })
}

async function onVolumeItemClicked() {
	// let target: number = -1;
	
	// if (api_data.volume == 0) {
	// 	if (unmutedVolume != 0) {
	// 		target = unmutedVolume;
	// 	}
	// }
	// else {
	// 	target = 0;
	// 	unmutedVolume = Number(api_data.volume);
	// }
	
	// if (target >= 0) {
	// 	await api.setVolume(target);
	// }
	
	// const icon = target == 0 ? "mute" : "unmute";
	// volumeItem.text = `$(${icon})  ${target}%`;
}

async function onControlItemClicked() {
	await apiCall("playpause");
	updateItems();
}

async function onNextItemClicked() {
	await apiCall("next");
	skipNotification = true;
	updateItems();
}

async function onPreviousItemClicked() {
	await apiCall("previous");
	skipNotification = true;
	updateItems();
}

async function getFocusedWindowPID(): Promise<string> {
	return await cmd("xdotool getwindowfocus");
}
