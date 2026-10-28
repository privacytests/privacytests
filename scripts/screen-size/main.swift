import Foundation
import CoreGraphics

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
        // Avoid listing duplicate resolutions
        if seenResolutions.contains(key) {
            continue
        }
        seenResolutions.insert(key)

        let isCurrent = (mode.width == currentMode.width && mode.height == currentMode.height)
        print(displayModeString(mode, isCurrent: isCurrent))
    }
}

func uniqueModes() -> [(width: Int, height: Int)] {
    let displayID = getMainDisplay()
    var seen = Set<String>()
    var result: [(width: Int, height: Int)] = []
    for mode in getAvailableDisplayModes(for: displayID) {
        let key = "\(mode.width)x\(mode.height)"
        if seen.contains(key) {
            continue
        }
        seen.insert(key)
        result.append((mode.width, mode.height))
    }
    return result
}

// Largest available mode with width < W and height < H (by width, then height).
func nextSmallerSize(thanWidth width: Int, height: Int) -> (width: Int, height: Int)? {
    return uniqueModes()
        .filter { $0.width < width && $0.height < height }
        .max { a, b in
            if a.width != b.width {
                return a.width < b.width
            }
            return a.height < b.height
        }
}

func setDisplayMode(width: Int, height: Int) {
    let displayID = getMainDisplay()
    let modes = getAvailableDisplayModes(for: displayID)

    guard let modeToSet = modes.first(where: { $0.width == width && $0.height == height }) else {
        fputs("No matching display mode found for \(width)x\(height)\n", stderr)
        exit(1)
    }

    let config = UnsafeMutablePointer<CGDisplayConfigRef?>.allocate(capacity: 1)
    defer { config.deallocate() }

    if CGBeginDisplayConfiguration(config) != .success {
        fputs("Failed to begin display configuration\n", stderr)
        exit(1)
    }

    if CGConfigureDisplayWithDisplayMode(config.pointee, displayID, modeToSet, nil) != .success {
        fputs("Failed to configure display mode\n", stderr)
        _ = CGCancelDisplayConfiguration(config.pointee)
        exit(1)
    }

    if CGCompleteDisplayConfiguration(config.pointee, .permanently) != .success {
        fputs("Failed to complete display configuration\n", stderr)
        exit(1)
    }

    print("\(width)x\(height)")
}

let args = CommandLine.arguments
let usage = """
usage: screen-size
       screen-size current
       screen-size next-smaller <width> <height>
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
case 4 where args[1] == "next-smaller":
    guard let width = Int(args[2]), let height = Int(args[3]) else {
        fputs(usage, stderr)
        exit(2)
    }
    guard let next = nextSmallerSize(thanWidth: width, height: height) else {
        fputs("No display mode smaller than \(width)x\(height) in both dimensions\n", stderr)
        exit(1)
    }
    print("\(next.width)x\(next.height)")
default:
    fputs(usage, stderr)
    exit(2)
}
