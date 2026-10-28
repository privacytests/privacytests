import Foundation
import CoreGraphics

// Deprecated dictionary-based APIs — still useful for attempting sizes that
// never appear in CGDisplayCopyAllDisplayModes (e.g. 1919x1079 on VMs).
@_silgen_name("CGDisplayAvailableModes")
func CGDisplayAvailableModes(_ display: CGDirectDisplayID) -> Unmanaged<CFArray>?

@_silgen_name("CGConfigureDisplayMode")
func CGConfigureDisplayMode(
  _ config: CGDisplayConfigRef?,
  _ display: CGDirectDisplayID,
  _ mode: CFDictionary?
) -> CGError

func getMainDisplay() -> CGDirectDisplayID {
    return CGMainDisplayID()
}

func getCurrentDisplayMode(for displayID: CGDirectDisplayID) -> CGDisplayMode? {
    return CGDisplayCopyDisplayMode(displayID)
}

func getAvailableDisplayModes(for displayID: CGDirectDisplayID) -> [CGDisplayMode] {
  let options = [
    kCGDisplayShowDuplicateLowResolutionModes: true as CFBoolean
  ] as CFDictionary

  guard let modes = CGDisplayCopyAllDisplayModes(displayID, options) as? [CGDisplayMode] else {
        return []
    }
    return modes
}

func displayModeString(_ mode: CGDisplayMode, isCurrent: Bool) -> String {
    let modeString = "\(mode.width) x \(mode.height)"
    return isCurrent ? "\(modeString) *" : modeString
}

func currentSizeString() -> String? {
    let displayID = getMainDisplay()
    guard let currentMode = getCurrentDisplayMode(for: displayID) else {
        return nil
    }
    return "\(currentMode.width)x\(currentMode.height)"
}

func listDisplayModes() {
    let displayID = getMainDisplay()
    guard let currentMode = getCurrentDisplayMode(for: displayID) else {
        fputs("Unable to determine current display mode.\n", stderr)
        exit(1)
    }

    let modes = getAvailableDisplayModes(for: displayID)
    var seenResolutions = Set<String>()

    for mode in modes {
        let key = "\(mode.width)x\(mode.height)"
        if seenResolutions.contains(key) {
            continue
        }
        seenResolutions.insert(key)

        let isCurrent = (mode.width == currentMode.width && mode.height == currentMode.height)
        print(displayModeString(mode, isCurrent: isCurrent))
    }
}

func beginConfig() -> CGDisplayConfigRef {
    let config = UnsafeMutablePointer<CGDisplayConfigRef?>.allocate(capacity: 1)
    defer { config.deallocate() }
    if CGBeginDisplayConfiguration(config) != .success || config.pointee == nil {
        fputs("Failed to begin display configuration\n", stderr)
        exit(1)
    }
    return config.pointee!
}

func completeConfig(_ config: CGDisplayConfigRef) {
    if CGCompleteDisplayConfiguration(config, .permanently) != .success {
        fputs("Failed to complete display configuration\n", stderr)
        exit(1)
    }
}

func setFromEnumeratedMode(width: Int, height: Int) -> Bool {
    let displayID = getMainDisplay()
    let modes = getAvailableDisplayModes(for: displayID)
    guard let modeToSet = modes.first(where: { $0.width == width && $0.height == height }) else {
        return false
    }

    let config = beginConfig()
    if CGConfigureDisplayWithDisplayMode(config, displayID, modeToSet, nil) != .success {
        _ = CGCancelDisplayConfiguration(config)
        return false
    }
    completeConfig(config)
    return true
}

// Clone an available mode dictionary with new Width/Height and apply via the
// deprecated CGConfigureDisplayMode path.
func setFromCustomDictionary(width: Int, height: Int) -> Bool {
    let displayID = getMainDisplay()
    guard let modesRef = CGDisplayAvailableModes(displayID)?.takeUnretainedValue(),
          let modes = modesRef as? [[String: Any]],
          let template = modes.first else {
        return false
    }

    var mode = template
    // Legacy mode dictionaries use these string keys.
    mode["Width"] = width
    mode["Height"] = height
    mode["kCGDisplayWidth"] = width
    mode["kCGDisplayHeight"] = height

    let config = beginConfig()
    let dict = mode as CFDictionary
    if CGConfigureDisplayMode(config, displayID, dict) != .success {
        _ = CGCancelDisplayConfiguration(config)
        return false
    }
    completeConfig(config)
    return true
}

func setDisplayMode(width: Int, height: Int) {
    if setFromEnumeratedMode(width: width, height: height) {
        print("\(width)x\(height)")
        return
    }
    if setFromCustomDictionary(width: width, height: height) {
        // Confirm the desktop actually moved; virtual displays sometimes accept
        // the configure call without changing the reported size.
        if let actual = currentSizeString(), actual == "\(width)x\(height)" {
            print(actual)
            return
        }
        fputs(
          "Custom mode configure returned success but size is \(currentSizeString() ?? "unknown") (wanted \(width)x\(height))\n",
          stderr)
        exit(1)
    }
    fputs("No matching display mode found for \(width)x\(height)\n", stderr)
    exit(1)
}

let args = CommandLine.arguments
let usage = """
usage: screen-size
       screen-size current
       screen-size <width> <height>
"""

switch args.count {
case 1:
    listDisplayModes()
case 2 where args[1] == "current":
    guard let current = currentSizeString() else {
        fputs("Unable to determine current display mode.\n", stderr)
        exit(1)
    }
    print(current)
case 3:
    if let width = Int(args[1]), let height = Int(args[2]) {
        setDisplayMode(width: width, height: height)
    } else {
        fputs(usage, stderr)
        exit(2)
    }
default:
    fputs(usage, stderr)
    exit(2)
}
