// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ModularCharacter",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "ModularCharacter", targets: ["ModularCharacter"])],
    targets: [
        .target(name: "ModularCharacter"),
        .testTarget(name: "ModularCharacterTests", dependencies: ["ModularCharacter"])
    ]
)
