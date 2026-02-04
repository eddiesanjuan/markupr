# Getting Started with FeedbackFlow

This guide walks you through setting up FeedbackFlow for the first time.

## Table of Contents

- [System Requirements](#system-requirements)
- [Installation](#installation)
- [First-Time Setup](#first-time-setup)
- [Obtaining a Deepgram API Key](#obtaining-a-deepgram-api-key)
- [Granting Permissions](#granting-permissions)
- [Your First Recording](#your-first-recording)

## System Requirements

### macOS
- macOS 10.15 (Catalina) or later
- Apple Silicon or Intel processor
- 4 GB RAM minimum
- 100 MB disk space

### Windows
- Windows 10 or later
- x64 processor
- 4 GB RAM minimum
- 100 MB disk space

### Linux
- Ubuntu 18.04+ or equivalent
- x64 processor
- 4 GB RAM minimum
- 100 MB disk space

## Installation

### macOS

1. Download the latest `.dmg` file from the [releases page](https://github.com/eddiesanjuan/feedbackflow/releases)
2. Open the downloaded DMG file
3. Drag the FeedbackFlow icon to your Applications folder
4. Eject the DMG
5. Open FeedbackFlow from your Applications folder

**Note**: On first launch, macOS may show a security warning. Click "Open" to continue, or go to System Preferences > Security & Privacy to allow the app.

### Windows

1. Download the latest `.exe` installer from the [releases page](https://github.com/eddiesanjuan/feedbackflow/releases)
2. Run the installer
3. Follow the installation wizard
4. Launch FeedbackFlow from the Start menu or desktop shortcut

### Linux

**AppImage:**
```bash
# Download the AppImage
wget https://github.com/eddiesanjuan/feedbackflow/releases/latest/download/FeedbackFlow.AppImage

# Make it executable
chmod +x FeedbackFlow.AppImage

# Run
./FeedbackFlow.AppImage
```

**Debian/Ubuntu:**
```bash
# Download and install
wget https://github.com/eddiesanjuan/feedbackflow/releases/latest/download/feedbackflow.deb
sudo dpkg -i feedbackflow.deb
sudo apt-get install -f  # Install dependencies if needed
```

## First-Time Setup

When you launch FeedbackFlow for the first time, the onboarding wizard will guide you through:

1. **Welcome** - Introduction to FeedbackFlow
2. **Permissions** - Granting required system permissions
3. **API Key** - Configuring your Deepgram API key
4. **Quick Tour** - Learning the basic workflow

You can skip the wizard and configure settings manually, but we recommend completing it.

## Obtaining a Deepgram API Key

FeedbackFlow uses Deepgram for real-time speech-to-text transcription. Here's how to get your API key:

### Step 1: Create a Deepgram Account

1. Go to [console.deepgram.com](https://console.deepgram.com)
2. Click "Sign Up" (or "Sign In" if you have an account)
3. Complete the registration process

### Step 2: Create an API Key

1. Once logged in, go to **API Keys** in the left sidebar
2. Click **Create a New API Key**
3. Give your key a descriptive name (e.g., "FeedbackFlow")
4. Select the following permissions:
   - **Usage** (required for transcription)
5. Click **Create Key**
6. **Copy the key immediately** - you won't be able to see it again!

### Step 3: Add the Key to FeedbackFlow

1. Open FeedbackFlow
2. Go to **Settings** (`Cmd+,` on macOS, `Ctrl+,` on Windows)
3. Navigate to **Advanced** > **Transcription Service**
4. Paste your API key in the input field
5. Click **Test Connection** to verify
6. You should see "API key verified and saved securely"

### Deepgram Free Tier

Deepgram offers a generous free tier:
- **200 hours** of transcription per month
- **No credit card required** to start
- Perfect for individual developers

For higher volume usage, Deepgram offers paid plans starting at pay-as-you-go pricing.

## Granting Permissions

FeedbackFlow requires certain system permissions to function properly.

### macOS Permissions

#### Microphone Access

FeedbackFlow needs microphone access to capture your voice narration.

1. When prompted, click **OK** to allow microphone access
2. If you denied access, go to:
   - System Preferences > Security & Privacy > Privacy > Microphone
   - Check the box next to FeedbackFlow

#### Screen Recording

FeedbackFlow needs screen recording permission to capture screenshots.

1. When prompted, click **Open System Preferences**
2. Go to Security & Privacy > Privacy > Screen Recording
3. Check the box next to FeedbackFlow
4. **Restart FeedbackFlow** for the change to take effect

#### Accessibility (Optional)

For global hotkeys to work in all applications:

1. Go to System Preferences > Security & Privacy > Privacy > Accessibility
2. Click the lock icon and enter your password
3. Check the box next to FeedbackFlow

### Windows Permissions

Windows typically handles permissions automatically. If you encounter issues:

1. Right-click on FeedbackFlow in the Start menu
2. Select "Run as administrator" (for first run only)
3. Follow any Windows Security prompts

### Linux Permissions

Depending on your distribution, you may need to:

```bash
# Add your user to the audio group for microphone access
sudo usermod -a -G audio $USER

# Log out and log back in for changes to take effect
```

## Your First Recording

Now that everything is set up, let's capture your first feedback!

### Step 1: Start Recording

Press the global hotkey:
- **macOS**: `Cmd+Shift+F`
- **Windows/Linux**: `Ctrl+Shift+F`

### Step 2: Select a Source

The Window Selector will appear. Choose what to capture:
- **Entire Screen** - Capture everything on one monitor
- **Specific Window** - Capture just one application window

Click on your selection to start.

### Step 3: Narrate Your Feedback

Start speaking! Some tips:
- Speak naturally and clearly
- Pause briefly when you want a screenshot captured
- The live transcription preview shows what FeedbackFlow hears

### Step 4: Screenshots

FeedbackFlow captures screenshots automatically when you pause speaking. You can also:
- Press `Cmd+Shift+S` (or `Ctrl+Shift+S`) to manually capture
- Watch the screenshot count in the overlay

### Step 5: Stop Recording

Press the hotkey again (`Cmd+Shift+F` or `Ctrl+Shift+F`) to stop.

### Step 6: Review and Export

After stopping:
1. The Session Review panel opens
2. Review your feedback items
3. Edit or delete items as needed
4. Click **Copy to Clipboard** or choose an export format

### Step 7: Use Your Feedback

Paste the copied feedback into your AI assistant:
- Claude
- ChatGPT
- Cursor
- GitHub Copilot

The Markdown format is optimized for AI consumption.

## Next Steps

- [Configure settings](CONFIGURATION.md) to customize FeedbackFlow
- [Learn keyboard shortcuts](KEYBOARD_SHORTCUTS.md) for efficient workflows
- [Explore export formats](EXPORT_FORMATS.md) for different use cases

## Troubleshooting

Having issues? Check our [Troubleshooting Guide](TROUBLESHOOTING.md) for common solutions.
