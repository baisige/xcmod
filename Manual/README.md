# XCMOD Game Cheat Engine - User Guide

## 1. Introduction

XCMOD is a powerful game memory modification tool that supports memory scanning, value modification, plugin management, and more. It helps gamers easily modify game data.

## 2. Installation & Startup

### 2.1 System Requirements
- OS: Windows 10/11
- No installation required, run directly

### 2.2 How to Start
1. Download and extract the XCMOD archive
2. Double-click `XCMOD.exe` to launch
3. First launch will automatically create `games/` directory for plugin storage

## 3. Basic Usage

### 3.1 Select Target Process

1. Launch your game
2. Find the game process in the left "Process List"
3. Click to select (green highlight indicates selected)

### 3.2 Memory Scanning (Find Address)

1. Enter the value you see in-game (e.g., health, gold) in the "Memory Scan" panel
2. Click [First Scan]
3. Return to game and change the value (e.g., take damage, spend gold)
4. Enter the new value in the cheat engine and click [Filter Scan]
5. Repeat steps 3-4 until only one address remains

### 3.3 Add Cheat Item

1. Right-click the found address in scan results
2. Select [Add to Current Game]
3. Enter cheat name (max 10 Chinese characters)
4. Set target value and data type
5. Click [Save]

## 4. Plugin Management

### 4.1 Upload Plugin

1. Click [Upload Plugin] button on the right
2. Choose one of the following methods:
   - Click [Select File] to upload JSON plugin file
   - Click [Paste JSON] to paste plugin configuration directly
   - Click [Download JSON-Demo] to get sample configuration

### 4.2 Create Plugin Configuration

Plugins are JSON format configuration files. Example:

```json
{
  "id": "example-game",
  "name": "Example Game",
  "executable": "Game.exe",
  "description": "This is a sample plugin",
  "cheats": [
    {
      "id": "unlimited-health",
      "name": "Unlimited Health",
      "address": "0x12345678",
      "value": 999,
      "dataType": "int"
    },
    {
      "id": "infinite-money",
      "name": "Infinite Money",
      "address": "0x1234567C",
      "value": 999999,
      "dataType": "int"
    }
  ]
}
```

### 4.3 Delete Cheat Item

1. Hover over the cheat card
2. Click the [×] button at top-right corner
3. Confirm deletion

## 5. Cheat Operations

### 5.1 One-Time Modification

1. Enter target value in the input field
2. Click [One-Time Modify] button
3. The value in-game will update immediately

### 5.2 Lock (Loop Modification)

1. Enter target value in the input field
2. Click [Lock] button (turns green when activated)
3. The value will be continuously locked
4. Click [Cancel] to stop locking

## 6. Data Types

| Type | Description | Range |
|------|-------------|-------|
| int | Integer | -2147483648 ~ 2147483647 |
| float | Single Precision Float | approx ±3.4×10³⁸ |
| double | Double Precision Float | approx ±1.7×10³⁰⁸ |
| byte | Byte | 0 ~ 255 |
| short | Short Integer | -32768 ~ 32767 |

## 7. Frequently Asked Questions

### Q1: Can't find game process?

- Ensure the game is running
- Try clicking [Refresh Process List]
- Check if the game is running as administrator

### Q2: Can't find address?

- Ensure the entered value matches the game
- Try different data types
- Some games use dynamic addresses requiring pointers

### Q3: Value reverts after modification?

- Use [Lock] feature to keep value locked
- Verify correct data type is selected

### Q4: Plugin upload failed?

- Check JSON format is valid
- Ensure all required fields are filled
- Address must start with `0x`

## 8. Safety Warning

1. Modifying game memory may violate game EULA
2. Using cheats in online games may result in account ban
3. Backup game saves before use
4. Only use in single-player games or private servers

## 9. Hotkeys

Hotkey functionality is not currently enabled. Will be added in future updates.

---

**Version**: 1.0  
**Updated**: April 2026  
**Developer**: XCMOD Team