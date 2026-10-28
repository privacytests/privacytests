#!/usr/bin/env swift

import Carbon
import Foundation

func stringProperty(_ source: TISInputSource, _ key: CFString) -> String? {
  guard let raw = TISGetInputSourceProperty(source, key) else {
    return nil
  }
  return Unmanaged<CFString>.fromOpaque(raw).takeUnretainedValue() as String
}

func boolProperty(_ source: TISInputSource, _ key: CFString) -> Bool {
  guard let raw = TISGetInputSourceProperty(source, key) else {
    return false
  }
  return CFBooleanGetValue(Unmanaged<CFBoolean>.fromOpaque(raw).takeUnretainedValue())
}

func inputSourceID(_ source: TISInputSource) -> String? {
  stringProperty(source, kTISPropertyInputSourceID)
}

func layoutCode(_ id: String) -> String {
  let prefix = "com.apple.keylayout."
  return id.hasPrefix(prefix) ? String(id.dropFirst(prefix.count)) : id
}

func currentLayoutID() -> String? {
  guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue() else {
    return nil
  }
  return inputSourceID(source)
}

func keyboardLayouts() -> [TISInputSource] {
  guard let all = TISCreateInputSourceList(nil, true)?.takeRetainedValue() as? [TISInputSource] else {
    return []
  }
  return all.filter { source in
    stringProperty(source, kTISPropertyInputSourceCategory) == (kTISCategoryKeyboardInputSource as String) &&
    stringProperty(source, kTISPropertyInputSourceType) == (kTISTypeKeyboardLayout as String)
  }
}

func listLayouts() {
  let current = currentLayoutID()
  for source in keyboardLayouts().sorted(by: { (inputSourceID($0) ?? "") < (inputSourceID($1) ?? "") }) {
    guard let id = inputSourceID(source) else { continue }
    let mark = id == current ? "*" : " "
    let enabled = boolProperty(source, kTISPropertyInputSourceIsEnabled) ? "on " : "off"
    print("\(mark) \(enabled)  \(layoutCode(id))")
  }
}

func selectLayout(_ argument: String) {
  let targetID = argument.contains(".") ? argument : "com.apple.keylayout.\(argument)"
  let filter = [kTISPropertyInputSourceID as String: targetID] as CFDictionary

  guard let sources = TISCreateInputSourceList(filter, true)?.takeRetainedValue() as? [TISInputSource],
        let source = sources.first else {
    fputs("unknown keyboard layout: \(targetID)\n", stderr)
    exit(1)
  }

  TISEnableInputSource(source)
  let status = TISSelectInputSource(source)
  guard status == noErr else {
    fputs("failed to select \(targetID) (OSStatus \(status))\n", stderr)
    exit(1)
  }

  let current = currentLayoutID() ?? "?"
  guard current == targetID else {
    fputs("selected \(targetID) but current layout is \(current)\n", stderr)
    exit(1)
  }

  print(current)
}

let usage = """
usage: setkeyboardlayout list
       setkeyboardlayout current
       setkeyboardlayout <layout>
example: setkeyboardlayout French
"""

guard CommandLine.argc == 2 else {
  fputs(usage, stderr)
  exit(2)
}

let argument = CommandLine.arguments[1]
if argument == "list" {
  listLayouts()
} else if argument == "current" {
  guard let current = currentLayoutID() else {
    fputs("could not determine current keyboard layout\n", stderr)
    exit(1)
  }
  print(current)
} else {
  selectLayout(argument)
}
