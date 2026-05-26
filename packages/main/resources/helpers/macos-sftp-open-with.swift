import AppKit
import Foundation

struct OpenWithApplication: Codable {
    let name: String
    let path: String
    let bundleIdentifier: String?
}

func writeJson<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    let data = try encoder.encode(value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

func listApplications(filePath: String) throws {
    let fileURL = URL(fileURLWithPath: filePath)
    let applications = NSWorkspace.shared.urlsForApplications(toOpen: fileURL).map { appURL in
        let bundle = Bundle(url: appURL)
        let bundleName = bundle?.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
        let fallbackName = bundle?.object(forInfoDictionaryKey: "CFBundleName") as? String
        let resolvedName = bundleName ?? fallbackName ?? appURL.deletingPathExtension().lastPathComponent

        return OpenWithApplication(
            name: resolvedName,
            path: appURL.path,
            bundleIdentifier: bundle?.bundleIdentifier
        )
    }

    try writeJson(applications)
}

func openFile(filePath: String, applicationPath: String) {
    let fileURL = URL(fileURLWithPath: filePath)
    let applicationURL = URL(fileURLWithPath: applicationPath)
    let configuration = NSWorkspace.OpenConfiguration()

    NSWorkspace.shared.open(
        [fileURL],
        withApplicationAt: applicationURL,
        configuration: configuration
    ) { _, error in
        if let error {
            FileHandle.standardError.write(Data(error.localizedDescription.utf8))
            exit(1)
        }

        exit(0)
    }

    RunLoop.main.run()
}

let arguments = CommandLine.arguments
guard arguments.count >= 3 else {
    FileHandle.standardError.write(Data("Usage: list <filePath> | open <filePath> <applicationPath>".utf8))
    exit(64)
}

do {
    switch arguments[1] {
    case "list":
        try listApplications(filePath: arguments[2])
    case "open":
        guard arguments.count >= 4 else {
            FileHandle.standardError.write(Data("Missing application path.".utf8))
            exit(64)
        }

        openFile(filePath: arguments[2], applicationPath: arguments[3])
    default:
        FileHandle.standardError.write(Data("Unknown command.".utf8))
        exit(64)
    }
} catch {
    FileHandle.standardError.write(Data(error.localizedDescription.utf8))
    exit(1)
}
