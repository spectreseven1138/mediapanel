import * as vscode from 'vscode';
const child_process = require("child_process");
const fs = require("fs");

const CONFIG_PATH = process.env.HOME + "/.config/vscode-mediapanel.json";

const displayNowPlayingNotification = false;
const volumeStep = 3;
const maxTitleLength = -1;
const statusBarHeight = 50;
const updateInternal = 0.25 * 1000;

let config: any = {};

let mediaItem: vscode.StatusBarItem;
let volumeItem: vscode.StatusBarItem;
let controlItem: vscode.StatusBarItem;
let nextItem: vscode.StatusBarItem;
let previousItem: vscode.StatusBarItem;
let soundBarItem: vscode.StatusBarItem;

let playingMedia: string | null = "";
let playerName: string = "";
let paused: boolean = false;
let skipNotification = false;
let unmutedVolume: Number = 0;
let currentTitleScroll = 0;
let windowPID: string | null = null;
let scrollEventMonitor: any = null;

const notify = vscode.window.showInformationMessage;

export function activate({ subscriptions }: vscode.ExtensionContext) {
	
	loadConfig();

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

function loadConfig(): void {
	fs.exists(CONFIG_PATH, (exists: boolean) => {
		if (exists) {
			fs.readFile(CONFIG_PATH, {encoding:'utf8', flag:'r'}, (err: any, data: any) =>  {
				if (err) throw err;
				config = JSON.parse(data);
			})
		}
	})
}

function saveConfig(): void {
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

function getVolumeData(): string {
	try {
		return cmd("amixer get Master | grep 'Right: '");
	} catch (error) {
		return cmd("amixer get Master | grep 'Mono: '");
	}
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

function onScrollMonitorSTDOUT(data: string) {
	
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
	const volumeData: string = getVolumeData();
	
	// Apply increased / decreased volume
	const volume = Math.max(0, Math.min(100, Number(volumeData.slice(volumeData.indexOf("[") + 1, volumeData.indexOf("]") - 1)) + (volumeStep * (up ? 1 : -1))));
	cmd(`amixer set Master ${volume}%`)
	
	const icon = volume == 0 ? "mute" : "unmute";
	volumeItem.text = `$(${icon})  ${volume}%`;
}

function updateItems(): void {
	
	// Update media Item
	const mediaData = cmd("pacmd list-sink-inputs").split("\n");
	let running = false;
	let skip = false;	
	let mediaName = null;
	
	paused = false;
	
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
			if (key == "media.name" && formatMediaName(value) === playingMedia) {
				mediaName = playingMedia;
				paused = true;
			}
			continue;
		}

		if (key == "index") {
			break;
		}

		if (key == "media.name") {
			mediaName = formatMediaName(value);
			paused = false;
		}	
		
		if (key == "application.process.binary") {
			if (("player_blacklist" in config && config.player_blacklist.includes(value)) || 
				("artist_blacklist" in config && config.artist_blacklist.includes(cmd("playerctl metadata --format '{{ artist }}' --player=" + value)))
			) {
				mediaName = null;
				running = false;
				playerName = "";
				continue;
			}

			playerName = value;
		}
	}
	
	if (mediaName == null) {
		mediaItem.hide();
		controlItem.hide();
		nextItem.hide();
		previousItem.hide();
	}
	else {
		const title: string = getReadableMediaName(mediaName);

		if (playingMedia != "" && playingMedia != mediaName) {
			if (skipNotification)
				skipNotification = false;
			else if (displayNowPlayingNotification)
				notify("Now playing: " + title);
			currentTitleScroll = 0;
		}
		
		if (maxTitleLength > 0 && title.length > maxTitleLength) {
			mediaItem.text = title.slice(currentTitleScroll, Math.min(currentTitleScroll + maxTitleLength, title.length));
			
			if (mediaItem.text.length < maxTitleLength) {
				mediaItem.text += "   | " + title.slice(0, maxTitleLength - mediaItem.text.length);
			}
			
			currentTitleScroll = (currentTitleScroll + 1) % title.length;
		}
		else {
			mediaItem.text = title;
		}
		
		playingMedia = mediaName;
		
		mediaItem.show();
		controlItem.show();
		nextItem.show();
		previousItem.show();
	}

	// Update volume Item
	const volumeData: string = getVolumeData();
	
	if (volumeData.includes("[off]")) {
		volumeItem.text = `$(mute) Muted`;
	}
	else {
		const volume = volumeData.slice(volumeData.indexOf("[") + 1, volumeData.indexOf("]"));
		const icon = volume === "0%" ? "mute" : "unmute";
		volumeItem.text = `$(${icon})  ${volume}`;
	}

	controlItem.text = `$(${paused ? "play" : "debug-pause"})`;
}

function onMediaItemClicked(): void {
	
	if (playingMedia == null) {
		return;
	}

	const artist: string = cmd("playerctl metadata --format '{{ artist }}' --player=" + playerName);
	const actions: Map<string, Function> = new Map();
	
	actions.set("Override title", overrideSongTitle);

	if ("title_replacements" in config && playingMedia in config.title_replacements) {
		actions.set("Clear title override", () => {
			if ("title_replacements" in config && playingMedia! in config.title_replacements) {
				delete config.title_replacements[playingMedia!];
			}
			saveConfig();
		});
	}

	actions.set("Blacklist player", () => {
		if (!("player_blacklist" in config)) {
			config.player_blacklist = [];
		}
		config.player_blacklist.push(playerName);
		saveConfig();
	});

	actions.set("Blacklist artist", () => {
		if (!("artist_blacklist" in config)) {
			config.artist_blacklist = [];
		}
		config.artist_blacklist.push(artist);
		saveConfig();
	});
	
	actions.set("Reload config", () => {
		loadConfig();
	})
	
	actions.set("Open config", () => {
		const openPath = vscode.Uri.file(CONFIG_PATH);
		vscode.workspace.openTextDocument(openPath).then(doc => {
			vscode.window.showTextDocument(doc);
		});
	})

	notify(
		getReadableMediaName(playingMedia) + "\n", 
		{modal: true, detail: 
			"Artist: " + artist
			+ "\n" + "Player: " + playerName
			+ "\n" + "Original title: " + playingMedia
		}, 
		...Array.from(actions.keys()).reverse()).then(action => {
		actions.get(action!)!();
	});
}

function overrideSongTitle(): void {

	if (playingMedia == null) {
		return;
	}

	vscode.window.showInputBox({
		title: "Input the title to replace '" + playingMedia + "'"
	}).then(input => {
		if (input === undefined) {
			return;
		}
		
		if (!("title_replacements" in config)) {
			config.title_replacements = {};
		}

		config.title_replacements[playingMedia!] = input;
		saveConfig()
	})
}

function onVolumeItemClicked(): void {
	const volumeData: string = getVolumeData();
	
	const volume = volumeData.slice(volumeData.indexOf("[") + 1, volumeData.indexOf("]") - 1);
	let target: Number = -1;
	
	if (volume == "0") {
		if (unmutedVolume != 0) {
			target = unmutedVolume;
		}
	}
	else {
		target = 0;
		unmutedVolume = Number(volume);
	}
	
	if (target >= 0) {
		cmd(`amixer set Master ${target}%`);
	}
	
	const icon = target == 0 ? "mute" : "unmute";
	volumeItem.text = `$(${icon})  ${target}%`;
}

function onControlItemClicked(): void {
	cmd("playerctl play-pause --player=" + playerName)
	updateItems();
}

function onNextItemClicked(): void {
	cmd("playerctl next --player=" + playerName);
	skipNotification = true;
	updateItems();
}

function onPreviousItemClicked(): void {
	cmd("playerctl previous --player=" + playerName);
	skipNotification = true;
	updateItems();
}

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

function getReadableMediaName(name: string): string {
	if ("title_replacements" in config && name in config.title_replacements) {
		return config.title_replacements[name].trim();
	}

	if ("substring_replacements" in config) {
		for (var key of Object.keys(config.substring_replacements)) {
			name = name.replace(key, config.substring_replacements[key]);
		}
	}
	
	return name.trim();
}

function formatMediaName(name: string): string {
	name = removePrefix(name, "\"");	
	name = removeSuffix(name, "\"");
	name = name.replace("_", " ");
	name = name.replace("  ", " ");

	const extensionIndex = name.lastIndexOf(".");
	const extension = name.slice(extensionIndex + 1);
	if (!extension.includes(" ")) {
		name = name.slice(0, extensionIndex);
	}

	return name.trim();
}

function getFocusedWindowPID(): string {
	return cmd("xdotool getwindowfocus").trim();
}
