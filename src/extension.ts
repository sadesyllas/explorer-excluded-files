'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as _ from 'lodash';

const filesExcludeKey = 'files.exclude';
const explorerExcludedFilesKey = 'explorerExcludedFiles';
const explorerExcludedFilesPatternsKey = 'explorerExcludedFiles.patterns';
const explorerExcludedFilesShowKey = 'explorerExcludedFiles.show';
const cycleDelay = 2500;

function getCodeName() {
	return `Code${/insider/i.test(vscode.version) ? ' - Insiders' : ''}`;
}

function getUserConfigurationFilePath() {
	if (/^linux/i.test(process.platform)) {
		return `${process.env.HOME}/.config/${getCodeName()}/User/settings.json`;
	}
	if (/^win/i.test(process.platform)) {
		return `${process.env.APPDATA}\\${getCodeName()}\\User\\settings.json`;
	}
	if (/^darwin/i.test(process.platform)) {
		return `${process.env.HOME}/Library/Application Support/${getCodeName()}/User/settings.json`;
	}
}

function getRootPath() {
	return vscode.workspace.rootPath;
}

function readUTF8(filePath) {
	return fs.readFileSync(filePath, { encoding: 'utf8' });
}

function writeUTF8(filePath, data) {
	fs.writeFileSync(filePath, data, { encoding: 'utf8' });
}

function sanitizeJSONString(jsonString) {
	if (!jsonString) {
		return jsonString;
	}
	return jsonString.replace(/^[^{]+|[^}]+$/, '').replace(/(.+?[^:])\/\/.+$/gm, '$1');
}

function readJSON(filepath) {
	return sanitizeJSONString(readUTF8(filepath));
}

function JSONStringify(json) {
	return JSON.stringify(json, null, 2);
}

function configurationsAreIdentical(configuration1, configuration2) {
	return _.isEqual(configuration1, configuration2);
}

function readUserConfiguration() {
	const userConfigurationFilePath = getUserConfigurationFilePath();
	const userConfigurationText = readJSON(userConfigurationFilePath);
	const userConfiguration = JSON.parse(userConfigurationText);
	return {
		text: userConfigurationText,
		json: userConfiguration,
	};
}

function writeUserConfiguration(userConfiguration) {
	const userConfigurationFilePath = getUserConfigurationFilePath();
	writeUTF8(userConfigurationFilePath,  JSONStringify(userConfiguration));
}

function start() {
	patchUserConfiguration();
}

function restart() {
	setTimeout(patchUserConfiguration, cycleDelay);
}

function readWorkspaceConfiguration() {
	const emptyConfiguration = {
		text: '{}',
		json: {},
	};
	const rootPath = getRootPath();

	if (!rootPath) {
		return emptyConfiguration;
	}

	const workspaceConfigurationFilePath = path.join(rootPath, '.vscode', 'settings.json');

	if (!fs.existsSync(workspaceConfigurationFilePath)) {
		return emptyConfiguration;
	}

	const workspaceConfigurationText = readJSON(workspaceConfigurationFilePath);

	return {
		text: workspaceConfigurationText,
		json: JSON.parse(workspaceConfigurationText),
	};
}

function writeWorkspaceConfiguration(workspaceConfiguration) {
	const rootPath = getRootPath();

	if (!rootPath) {
		return;
	}

	const workspaceVSCodeDirectoryPath = path.join(rootPath, '.vscode');

	if (!fs.existsSync(workspaceVSCodeDirectoryPath)) {
		fs.mkdirSync(workspaceVSCodeDirectoryPath);
	}

	writeUTF8(path.join(workspaceVSCodeDirectoryPath, 'settings.json'), JSONStringify(workspaceConfiguration));
}

function clearWorkspaceConfiguration() {
	const rootPath = getRootPath();

	if (!rootPath) {
		return;
	}

	const { text: workspaceConfigurationText, json: workspaceConfiguration } = readWorkspaceConfiguration();

	Object.keys(workspaceConfiguration[filesExcludeKey] || {}).forEach(e => {
		if (workspaceConfiguration[filesExcludeKey][e] === 'explorerExcludedFiles') {
			delete workspaceConfiguration[filesExcludeKey][e];
		}
	});

	if (!Object.keys(workspaceConfiguration[filesExcludeKey] || {}).length) {
		delete workspaceConfiguration[filesExcludeKey];
	}

	if (workspaceConfiguration[explorerExcludedFilesShowKey]) {
		if (!configurationsAreIdentical(workspaceConfiguration, JSON.parse(workspaceConfigurationText))) {
			writeWorkspaceConfiguration(workspaceConfiguration);
		}

		return;
	}

	const workspaceConfigurationKeys = Object.keys(workspaceConfiguration);

	if (!workspaceConfigurationKeys.length ||
			(workspaceConfigurationKeys.length === 1 &&
			 typeof(workspaceConfiguration[explorerExcludedFilesShowKey]) !== 'undefined' &&
			 !workspaceConfiguration[explorerExcludedFilesShowKey])) {
		const workspaceVSCodeDirectoryPath = path.join(rootPath, '.vscode');
		const workspaceVSCodeDirectoryEntries = fs.existsSync(workspaceVSCodeDirectoryPath)
			? fs.readdirSync(workspaceVSCodeDirectoryPath)
			: [];

		if (workspaceVSCodeDirectoryEntries.length === 1 && workspaceVSCodeDirectoryEntries[0] === 'settings.json') {
			fs.unlinkSync(path.join(workspaceVSCodeDirectoryPath, 'settings.json'));
			fs.rmdirSync(workspaceVSCodeDirectoryPath);
		}
		
		return;
	}

	if (!configurationsAreIdentical(workspaceConfiguration, JSON.parse(workspaceConfigurationText))) {
		writeWorkspaceConfiguration(workspaceConfiguration);
	}
}

function patchWorkspaceConfiguration(patterns: string[]) {
	patterns = patterns || [];

	const rootPath = getRootPath();

	if (!rootPath) {
		return;
	}

	const { text: workspaceConfigurationText, json: workspaceConfiguration } = readWorkspaceConfiguration();

	if (workspaceConfiguration[explorerExcludedFilesShowKey]) {
		return;
	}

	if (!workspaceConfiguration[filesExcludeKey]) {
		workspaceConfiguration[filesExcludeKey] = {};
	}

	patterns.forEach(pattern => {
		if (/^file:\/\//i.test(pattern)) {
			const filePath = path.join(rootPath, pattern.replace(/^file:\/\//i, ''));
			if (fs.existsSync(filePath)) {
				readUTF8(filePath).split(/\r?\n/g).map(p => p.trim()).filter(p => !/^\s*$/.test(p) && p[0] !== '#')
					.map(p => p.replace(/^\/+/, '')).filter(p => typeof(workspaceConfiguration[filesExcludeKey][p]) === 'undefined')
					.forEach(p => workspaceConfiguration[filesExcludeKey][p] = 'explorerExcludedFiles');
			}
			return;
		}

		if (typeof(workspaceConfiguration[filesExcludeKey][pattern]) === 'undefined') {
			workspaceConfiguration[filesExcludeKey][pattern] = 'explorerExcludedFiles';
		}
	});

	if (!configurationsAreIdentical(workspaceConfiguration, JSON.parse(workspaceConfigurationText))) {
		writeWorkspaceConfiguration(workspaceConfiguration);
	}
}

function patchUserConfiguration() {
	const rootPath = getRootPath();

	const { text: userConfigurationText, json: userConfiguration } = readUserConfiguration();
	let explorerExcludedFilesPatterns = <string[]>vscode.workspace.getConfiguration(explorerExcludedFilesKey).get('patterns');

	if (!explorerExcludedFilesPatterns) {
		userConfiguration[explorerExcludedFilesPatternsKey] = [ 'file://.gitignore' ];
		explorerExcludedFilesPatterns = userConfiguration[explorerExcludedFilesPatternsKey];
	}

	if (!configurationsAreIdentical(userConfiguration, JSON.parse(userConfigurationText))) {
		writeUserConfiguration(userConfiguration);
	}

	clearWorkspaceConfiguration();

	if (!rootPath) {
		restart();
		return;
	}

	patchWorkspaceConfiguration(explorerExcludedFilesPatterns);

	restart();
}

function toggleExplorerExcludedFiles(show: boolean) {
	const rootPath = getRootPath();

	if (!rootPath) {
		return;
	}

	const { json: workspaceConfiguration } = readWorkspaceConfiguration();

	if ((show && workspaceConfiguration[explorerExcludedFilesShowKey]) ||
			(!show && !workspaceConfiguration[explorerExcludedFilesShowKey])) {
		return;
	}

	workspaceConfiguration[explorerExcludedFilesShowKey] = show;

	writeWorkspaceConfiguration(workspaceConfiguration);
}

export function activate(context: vscode.ExtensionContext) {
	start();

	const commandShowProjectExcludedFiles = vscode.commands.registerCommand('extension.showExplorerExcludedFiles', () => toggleExplorerExcludedFiles(true));

	const commandHideProjectExcludedFiles = vscode.commands.registerCommand('extension.hideExplorerExcludedFiles', () => toggleExplorerExcludedFiles(false));

	context.subscriptions.push(commandShowProjectExcludedFiles, commandHideProjectExcludedFiles);
}

export function deactivate(context: vscode.ExtensionContext) {
	clearWorkspaceConfiguration();
}
