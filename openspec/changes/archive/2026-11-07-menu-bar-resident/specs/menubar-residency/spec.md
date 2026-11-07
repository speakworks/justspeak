## ADDED Requirements

### Requirement: Closing the window SHALL NOT end the app

Closing the main window SHALL hide it and leave the application running. The
hotkey, the recording pipeline and the menu-bar icon SHALL keep working with no
window on screen, and reopening the window SHALL NOT lose the text already in the
home input.

An explicit quit SHALL NOT be turned into a hide. `Cmd+Q`, the Dock's 退出 and
the application menu's 退出 SHALL all end the process, and `window-all-closed`
SHALL NOT quit on its own.

#### Scenario: The user closes the window

- **WHEN** the user closes the main window without having requested a quit
- **THEN** the window is hidden and the process keeps running
- **AND** the menu-bar icon stays in the menu bar
- **AND** pressing the dictation hotkey still starts a recording

#### Scenario: The user quits

- **WHEN** the user chooses 退出 from the application menu, the menu-bar icon, or `Cmd+Q`
- **THEN** the app quits instead of hiding the window

#### Scenario: The window comes back

- **WHEN** the window was closed and the user reopens it from the menu bar, the Dock, or a second launch
- **THEN** the window is shown, restored from minimized if needed, and focused
- **AND** the text already in the home input is still there

### Requirement: A menu-bar icon SHALL carry the actions that outlive the window

The app SHALL show a template icon in the macOS menu bar. Its menu SHALL contain,
in this order, a window item, a dictation item, a settings item and a quit item,
in every session state. The icon SHALL adapt to a dark menu bar and to the
reduced-transparency setting by way of a template image.

The window item SHALL actually perform the action its label names: choosing
隐藏主窗口 while the window is visible hides it, and choosing 显示主窗口 while it
is hidden shows it. A bare left click on the icon SHALL open the menu only and
SHALL NOT activate the app, so dictating into another application is never
interrupted by choosing from the icon's menu.

The application menu SHALL offer the same dictation and settings entry points,
and SHALL NOT expose renderer reload or developer tools, which in a resident app
are two ways to break a running session from a menu item. Its dictation item
SHALL name the live hotkey in its label and SHALL NOT register a key equivalent,
which on macOS would double-fire with the same chord registered through the
global shortcut.

#### Scenario: A Dock click while the app is still starting

- **WHEN** the Dock icon is clicked before the startup chain has created the window
- **THEN** no duplicate window is created
- **AND** the window the startup chain creates is the only one

The dictation item SHALL name the action it performs — start, stop, or in
progress — and SHALL be disabled rather than silently doing nothing while a
transcript is in flight. The window item SHALL read 显示主窗口 while the window is
hidden and 隐藏主窗口 while it is visible.

#### Scenario: The menu reflects an idle session

- **WHEN** the window is closed and no dictation is running
- **THEN** the menu offers 显示主窗口 and 开始听写, both enabled

#### Scenario: The menu reflects a recording

- **WHEN** a recording is in progress
- **THEN** the dictation item offers 结束听写 and starting it stops the recording

#### Scenario: A transcript is in flight

- **WHEN** the session is transcribing or pasting
- **THEN** the dictation item is disabled and says so
- **AND** the window, settings and quit items stay enabled

#### Scenario: Opening settings from the menu bar

- **WHEN** the user chooses 设置… from the menu-bar icon while the window is closed
- **THEN** the window is shown with the settings destination selected

### Requirement: The window SHALL stay capture-capable while hidden

The main window SHALL NOT be throttled by Chromium while hidden, because it hosts
the microphone capture. A recording started from the menu bar or the hotkey while
the window is closed SHALL capture audio at the same rate as it does with the
window visible.

#### Scenario: Dictating with the window closed

- **WHEN** the window is closed and a recording starts from the hotkey or the menu bar
- **THEN** audio batches continue to arrive for the whole recording
- **AND** the transcript is delivered to the frontmost app or the copy panel,
  never to the hidden window

### Requirement: The packaged app SHALL carry the JustSpeak icon

A packaged build SHALL show the product icon on the Dock, in Finder and on the
installer, not Electron's default icon, and SHALL ship the menu-bar template
images where the running app reads them.

#### Scenario: A packaged build

- **WHEN** the app is packaged
- **THEN** the bundle's icon is the JustSpeak mark
- **AND** `Contents/Resources/resources` holds both menu-bar template images
