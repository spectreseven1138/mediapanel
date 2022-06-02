import * as vscode from 'vscode';
import * as API from "./mediaAPI";

const child_process = require("child_process");
const fs = require("fs");

const displayNowPlayingNotification = false;
const volumeStep = 3;
const statusBarHeight = 50;
const updateInternal = 0.25 * 1000;

let api: API.MediaAPI

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

export function activate({ subscriptions }: vscode.ExtensionContext) {
	
	function loadFile(path: string): Promise<string> {
		path = process.env.HOME + path;
		return new Promise((resolve, reject) => {
			fs.exists(path, (exists: boolean) => {
				if (exists) {
					fs.readFile(path, {encoding:'utf8', flag:'r'}, (err: any, data: any) =>  {
						if (err) {
							reject(err);
						}
						resolve(data);
					})
				}
				else {
					reject(Error(`No file exists at path ${path}`));
				}
			})
		})
	}

	function saveFile(path: string, content: string): void {
		fs.writeFileSync(process.env.HOME + path, content, "utf8");
	}

	api = new API.MediaAPI((command: Array<string>) => {
		return new Promise((resolve, reject) => {
			resolve(cmd(command.join(" ")));
		});
	}, loadFile, saveFile);

	api.setVisibleCallback = (visible: boolean) => {
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

	api.setTitleCallback = (title: string) => {
		mediaItem.text = title;
	}

	api.setVolumeCallback = (volume: number, muted: boolean) => {
		if (muted) {
			volumeItem.text = `$(mute) Muted`;
		}
		else {
			const icon = volume === 0 ? "mute" : "unmute";
			volumeItem.text = `$(${icon})  ${volume}%`;
		}
	}

	api.setPlayingCallback = (playing: boolean) => {
		controlItem.text = `$(${playing ? "debug-pause" : "play"})`;
	}

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
	nextItem.text = ">";
	nextItem.show();
	
	controlItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, alignment++);
	controlItem.command = controlCommandId;
	controlItem.show();
	
	previousItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, alignment++);
	previousItem.command = previousCommandId;
	previousItem.text = "<";
	previousItem.show();
	
	mediaItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, alignment++);
	mediaItem.command = mediaCommandId;
	mediaItem.show();
	
	soundBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, alignment++);
	soundBarItem.show();
	
	if (vscode.window.state.focused) {
		windowPID = getFocusedWindowPID();
		scrollEventMonitor = child_process.exec(`xev -id ${windowPID}`);
		scrollEventMonitor.stdout?.on('data', onScrollMonitorSTDOUT);
	}
	else {
		subscriptions.push(vscode.window.onDidChangeWindowState(onWindowStateChanged));
	}

	setInterval(mainLoop, updateInternal);
}

export function deactivate() {
	scrollEventMonitor?.kill("SIGKILL");
}

function mainLoop() {
	updateItems();
}

function cmd(command: string): string {
	return child_process.execSync(command).toString().trim();
}

function onWindowStateChanged() {
	
	if (windowPID != null)
		return;
	
	if (vscode.window.state.focused) {
		windowPID = getFocusedWindowPID();
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
	const windowData = cmd(`xdotool getwindowgeometry --shell ${windowPID} getmouselocation --shell`).split("\n");
	
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

	// Get the current volume level
	let [volume] = await api.getVolumeData(volumeStep * (up ? 1 : -1));

	// Apply increased / decreased volume
	cmd(`amixer set Master ${volume}%`)
	
	const icon = volume == 0 ? "mute" : "unmute";
	volumeItem.text = `$(${icon})  ${volume}%`;
}

async function updateItems() {
	let changed = await api.update();
	if (changed) {
		if (skipNotification) {
			skipNotification = false;
		}
		else if (displayNowPlayingNotification && api.current_source) {
			notify("Now playing: " + api.current_source.title);
		}
	}
}

function onMediaItemClicked() {
	
	if (api.current_source == null) {
		return;
	}

	const artist: string = cmd("playerctl metadata --format '{{ artist }}' --player=" + api.current_source.player);
	const actions: Map<string, Function> = new Map();
	
	actions.set("Override title", overrideSongTitle);

	// TODO Move to API
	if ("title_replacements" in api._config && api.current_source.title in api._config.title_replacements) {
		actions.set("Clear title override", () => {
			if ("title_replacements" in api._config && api.current_source && api.current_source.title in api._config.title_replacements) {
				delete api._config.title_replacements[api.current_source.title];
			}
			api.saveConfig();
			api.onConfigChanged();
		});
	}

	actions.set("Blacklist player", () => {
		if (!("player_blacklist" in api._config)) {
			api._config.player_blacklist = [];
		}
		api._config.player_blacklist.push(api.current_source?.player);
		api.saveConfig();
		api.onConfigChanged();
	});

	actions.set("Blacklist artist", () => {
		if (!("artist_blacklist" in api._config)) {
			api._config.artist_blacklist = [];
		}
		api._config.artist_blacklist.push(artist);
		api.saveConfig();
		api.onConfigChanged();
	});

	actions.set("Blacklist keyword", () => {
		vscode.window.showInputBox({
			placeHolder: "Input the keyword to blacklist"
		}).then((input: any) => {
			if (input === undefined) {
				return;
			}
			
			if (!("keyword_blacklist" in api._config)) {
				api._config.keyword_blacklist = [input];
			}
			else {
				api._config.keyword_blacklist.push(input);
			}
	
			api.saveConfig()
			api.onConfigChanged();
		})
	});
	
	actions.set("Reload config", () => {
		api.loadConfig();
	})
	
	actions.set("Open config", async () => {
		const openPath = vscode.Uri.file(process.env.HOME + api.getConfigPath());
		vscode.workspace.openTextDocument(openPath).then((doc: any) => {
			vscode.window.showTextDocument(doc);
		});
	})

	actions.set("List sources", () => {
		let detail: string = "";
		api.sources.forEach((source: API.Source) => {
			detail += "\n\n" + source.toString(api);
		})
		notify("Detected sources (excluding blacklisted):", {modal:true, detail: detail});
	})

	let detail: string =
		"Artist: " + artist
		+ "\n" + "Player: " + api.current_source.player
		+ "\n" + "Original title: " + api.current_source.title;
	
	notify(
		api.current_source.getReadableTitle(api) + "\n", {modal: true, detail: detail}, 
		...Array.from(actions.keys()).reverse()).then((action: any) => {
		actions.get(action!)!();
	});
}

function overrideSongTitle(): void {

	if (api.current_source == null) {
		return;
	}

	vscode.window.showInputBox({
		placeHolder: "Input the title to replace '" + api.current_source.title + "'",
		value: api.current_source.title
	}).then((input: any) => {
		if (input === undefined || api.current_source == null) {
			return;
		}
		
		if (!("title_replacements" in api._config)) {
			api._config.title_replacements = {};
		}

		api._config.title_replacements[api.current_source.title] = input;
		api.saveConfig()
		api.onConfigChanged();
	})
}

async function onVolumeItemClicked() {
	const [volume] = await api.getVolumeData();
	let target: number = -1;
	
	if (volume == 0) {
		if (unmutedVolume != 0) {
			target = unmutedVolume;
		}
	}
	else {
		target = 0;
		unmutedVolume = Number(volume);
	}
	
	if (target >= 0) {
		await api.setVolume(target);
	}
	
	const icon = target == 0 ? "mute" : "unmute";
	volumeItem.text = `$(${icon})  ${target}%`;
}

async function onControlItemClicked() {
	await api.mediaPlayPause();
	updateItems();
}

async function onNextItemClicked() {
	await api.mediaForward();
	skipNotification = true;
	updateItems();
}

async function onPreviousItemClicked() {
	await api.mediaBackward();
	skipNotification = true;
	updateItems();
}

function getFocusedWindowPID(): string {
	return cmd("xdotool getwindowfocus");
}
