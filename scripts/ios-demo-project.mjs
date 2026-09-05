/** An unsigned simulator app consuming the bundled ModularCharacter Swift package; users choose their own device team. */
export function xcodeProject() {
  return `// !$*UTF8*$!
{
 archiveVersion = 1;
 classes = {};
 objectVersion = 56;
 objects = {
  A00000000000000000000001 = {isa = PBXProject; attributes = {LastUpgradeCheck = 2620;}; buildConfigurationList = A00000000000000000000002; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; knownRegions = (en, Base); mainGroup = A00000000000000000000003; productRefGroup = A00000000000000000000004; projectDirPath = ""; projectRoot = ""; packageReferences = (A00000000000000000000013); targets = (A00000000000000000000005);};
  A00000000000000000000002 = {isa = XCConfigurationList; buildConfigurations = (A00000000000000000000006, A00000000000000000000007); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;};
  A00000000000000000000003 = {isa = PBXGroup; children = (A00000000000000000000008, A00000000000000000000009, A00000000000000000000016, A00000000000000000000004); sourceTree = "<group>";};
  A00000000000000000000004 = {isa = PBXGroup; children = (A0000000000000000000000A); name = Products; sourceTree = "<group>";};
  A00000000000000000000005 = {isa = PBXNativeTarget; buildConfigurationList = A0000000000000000000000B; buildPhases = (A0000000000000000000000C, A0000000000000000000000D, A0000000000000000000000E); buildRules = (); dependencies = (); packageProductDependencies = (A00000000000000000000014); name = PlateDemo; productName = PlateDemo; productReference = A0000000000000000000000A; productType = "com.apple.product-type.application";};
  A00000000000000000000006 = {isa = XCBuildConfiguration; buildSettings = {SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; CLANG_ENABLE_MODULES = YES;}; name = Debug;};
  A00000000000000000000007 = {isa = XCBuildConfiguration; buildSettings = {SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 17.0; SWIFT_VERSION = 5.0; CLANG_ENABLE_MODULES = YES;}; name = Release;};
  A00000000000000000000008 = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = PlateDemo.swift; sourceTree = "<group>";};
  A00000000000000000000009 = {isa = PBXFileReference; lastKnownFileType = folder; path = CharacterRuntime; sourceTree = "<group>";};
  A0000000000000000000000A = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = PlateDemo.app; sourceTree = BUILT_PRODUCTS_DIR;};
  A0000000000000000000000B = {isa = XCConfigurationList; buildConfigurations = (A0000000000000000000000F, A00000000000000000000010); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;};
  A0000000000000000000000C = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (A00000000000000000000011); runOnlyForDeploymentPostprocessing = 0;};
  A0000000000000000000000D = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (A00000000000000000000015); runOnlyForDeploymentPostprocessing = 0;};
  A0000000000000000000000E = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (A00000000000000000000012, A00000000000000000000017); runOnlyForDeploymentPostprocessing = 0;};
  A0000000000000000000000F = {isa = XCBuildConfiguration; buildSettings = {PRODUCT_BUNDLE_IDENTIFIER = studio.modularcharacter.PlateDemo; PRODUCT_NAME = "$(TARGET_NAME)"; GENERATE_INFOPLIST_FILE = YES; INFOPLIST_KEY_CFBundleDisplayName = MCS; ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; CURRENT_PROJECT_VERSION = 1; MARKETING_VERSION = 0.1.0; INFOPLIST_KEY_UILaunchScreen_Generation = YES; INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES; INFOPLIST_KEY_UISupportedInterfaceOrientations = "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"; TARGETED_DEVICE_FAMILY = "1,2"; CODE_SIGN_STYLE = Automatic; SWIFT_OPTIMIZATION_LEVEL = "-Onone";}; name = Debug;};
  A00000000000000000000010 = {isa = XCBuildConfiguration; buildSettings = {PRODUCT_BUNDLE_IDENTIFIER = studio.modularcharacter.PlateDemo; PRODUCT_NAME = "$(TARGET_NAME)"; GENERATE_INFOPLIST_FILE = YES; INFOPLIST_KEY_CFBundleDisplayName = MCS; ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; CURRENT_PROJECT_VERSION = 1; MARKETING_VERSION = 0.1.0; INFOPLIST_KEY_UILaunchScreen_Generation = YES; INFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES; INFOPLIST_KEY_UISupportedInterfaceOrientations = "UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight"; TARGETED_DEVICE_FAMILY = "1,2"; CODE_SIGN_STYLE = Automatic; SWIFT_OPTIMIZATION_LEVEL = "-O";}; name = Release;};
  A00000000000000000000011 = {isa = PBXBuildFile; fileRef = A00000000000000000000008;};
  A00000000000000000000012 = {isa = PBXBuildFile; fileRef = A00000000000000000000009;};
  A00000000000000000000013 = {isa = XCLocalSwiftPackageReference; relativePath = ModularCharacter;};
  A00000000000000000000014 = {isa = XCSwiftPackageProductDependency; package = A00000000000000000000013; productName = ModularCharacter;};
  A00000000000000000000015 = {isa = PBXBuildFile; productRef = A00000000000000000000014;};
  A00000000000000000000016 = {isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>";};
  A00000000000000000000017 = {isa = PBXBuildFile; fileRef = A00000000000000000000016;};
 };
 rootObject = A00000000000000000000001;
}
`
}
