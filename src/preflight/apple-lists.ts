/**
 * Apple's lists, copied from Apple's pages on the date in rules.ts. Tests build
 * their fixtures from these, so a change here moves both sides together.
 */

/** Required reason API: https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api */
export const REQUIRED_REASON_CATEGORIES = {
  NSPrivacyAccessedAPICategoryFileTimestamp: {
    label: "file timestamps",
    reasons: ["DDA9.1", "C617.1", "3B52.1", "0A2A.1"],
    source: [
      /\bfileModificationDate\b/,
      /\bcontentModificationDateKey\b/,
      /\bcreationDateKey\b/,
      /\bNSFile(Creation|Modification)Date\b/,
      /\bFileAttributeKey\.(creationDate|modificationDate)\b/,
      /\b(getattrlist|getattrlistbulk|fgetattrlist|getattrlistat|fstat|fstatat|lstat)\s*\(/,
      /\bstat\s*\([^)]*&/,
    ],
    // Plain property names that apps also use for their own models.
    weakSource: [/\[\s*\.(creationDate|modificationDate)\s*\]/],
    symbols: ["_stat", "_fstat", "_fstatat", "_lstat", "_getattrlist", "_getattrlistbulk", "_fgetattrlist", "_getattrlistat", "_NSFileCreationDate", "_NSFileModificationDate", "_NSURLCreationDateKey", "_NSURLContentModificationDateKey"],
  },
  NSPrivacyAccessedAPICategorySystemBootTime: {
    label: "system boot time",
    reasons: ["35F9.1", "8FFB.1", "3D61.1"],
    source: [/\bsystemUptime\b/, /\bmach_absolute_time\b/],
    weakSource: [],
    symbols: ["_mach_absolute_time"],
  },
  NSPrivacyAccessedAPICategoryDiskSpace: {
    label: "disk space",
    reasons: ["85F4.1", "E174.1", "7D9E.1", "B728.1"],
    source: [
      /\bvolumeAvailableCapacity(ForImportantUsage|ForOpportunisticUsage)?Key\b/,
      /\bvolumeTotalCapacityKey\b/,
      /\bsystemFreeSize\b/,
      /\bNSFileSystem(Free)?Size\b/,
      /\b(statfs|statvfs|fstatfs|fstatvfs)\s*\(/,
    ],
    weakSource: [/\bsystemSize\b/],
    symbols: ["_statfs", "_statvfs", "_fstatfs", "_fstatvfs", "_NSFileSystemSize", "_NSFileSystemFreeSize", "_NSURLVolumeAvailableCapacityKey", "_NSURLVolumeAvailableCapacityForImportantUsageKey", "_NSURLVolumeAvailableCapacityForOpportunisticUsageKey", "_NSURLVolumeTotalCapacityKey"],
  },
  NSPrivacyAccessedAPICategoryActiveKeyboards: {
    label: "active keyboards",
    reasons: ["3EC4.1", "54BD.1"],
    source: [/\bactiveInputModes\b/],
    weakSource: [],
    symbols: [],
  },
  NSPrivacyAccessedAPICategoryUserDefaults: {
    label: "user defaults",
    reasons: ["CA92.1", "1C8F.1", "C56D.1", "AC6B.1"],
    source: [/\bUserDefaults\b/, /\bNSUserDefaults\b/, /@AppStorage\b/],
    weakSource: [],
    symbols: ["_OBJC_CLASS_$_NSUserDefaults"],
    // Swift's mangled names, for Foundation.UserDefaults and SwiftUI's @AppStorage.
    symbolFragments: ["10Foundation12UserDefaultsC", "14NSUserDefaultsC"],
  },
} as const satisfies Record<string, {
  label: string;
  reasons: readonly string[];
  source: readonly RegExp[];
  weakSource: readonly RegExp[];
  symbols: readonly string[];
  symbolFragments?: readonly string[];
}>;

export type RequiredReasonCategory = keyof typeof REQUIRED_REASON_CATEGORIES;

/**
 * APIs that need a purpose string. `keys` lists every Info.plist key that
 * satisfies the API, because some APIs have more than one valid key.
 * Source: https://developer.apple.com/documentation/bundleresources/protected-resources
 * PHPickerViewController is left out on purpose: it needs no permission.
 */
export const PURPOSE_STRINGS: ReadonlyArray<{ api: string; pattern: RegExp; keys: readonly string[] }> = [
  { api: "the camera", pattern: /\b(AVCaptureDevice|AVCaptureSession|DataScannerViewController)\b/, keys: ["NSCameraUsageDescription"] },
  { api: "the microphone", pattern: /\b(AVAudioRecorder|recordPermission|requestRecordPermission)\b/, keys: ["NSMicrophoneUsageDescription"] },
  { api: "the photo library", pattern: /\b(PHPhotoLibrary|PHAsset)\b/, keys: ["NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription"] },
  { api: "location", pattern: /\brequestWhenInUseAuthorization\b/, keys: ["NSLocationWhenInUseUsageDescription"] },
  { api: "location always", pattern: /\brequestAlwaysAuthorization\b/, keys: ["NSLocationAlwaysAndWhenInUseUsageDescription"] },
  { api: "contacts", pattern: /\bCNContactStore\b/, keys: ["NSContactsUsageDescription"] },
  { api: "calendars or reminders", pattern: /\bEKEventStore\b/, keys: ["NSCalendarsFullAccessUsageDescription", "NSCalendarsWriteOnlyAccessUsageDescription", "NSCalendarsUsageDescription", "NSRemindersFullAccessUsageDescription", "NSRemindersUsageDescription"] },
  { api: "Health data", pattern: /\bHKHealthStore\b/, keys: ["NSHealthShareUsageDescription", "NSHealthUpdateUsageDescription"] },
  { api: "Bluetooth", pattern: /\b(CBCentralManager|CBPeripheralManager)\b/, keys: ["NSBluetoothAlwaysUsageDescription"] },
  { api: "tracking", pattern: /\bATTrackingManager\b/, keys: ["NSUserTrackingUsageDescription"] },
  { api: "Face ID", pattern: /\bdeviceOwnerAuthentication(WithBiometrics)?\b/, keys: ["NSFaceIDUsageDescription"] },
  { api: "speech recognition", pattern: /\bSFSpeechRecognizer\b/, keys: ["NSSpeechRecognitionUsageDescription"] },
  { api: "the music library", pattern: /\bMPMediaLibrary\b/, keys: ["NSAppleMusicUsageDescription"] },
  { api: "motion", pattern: /\b(CMMotionActivityManager|CMPedometer)\b/, keys: ["NSMotionUsageDescription"] },
  { api: "NFC", pattern: /\b(NFCNDEFReaderSession|NFCTagReaderSession)\b/, keys: ["NFCReaderUsageDescription"] },
  { api: "HomeKit", pattern: /\bHMHomeManager\b/, keys: ["NSHomeKitUsageDescription"] },
];

/** Every key above, as a pattern over Info.plist-like files. */
export const PURPOSE_KEY_PATTERN = /^(NS[A-Za-z]+UsageDescription|NFCReaderUsageDescription)$/;

/** https://developer.apple.com/support/third-party-SDK-requirements/ */
export const LISTED_SDKS: readonly string[] = [
  "Abseil", "AFNetworking", "Alamofire", "AppAuth", "BoringSSL", "openssl_grpc", "Capacitor", "Charts",
  "connectivity_plus", "Cordova", "device_info_plus", "DKImagePickerController", "DKPhotoGallery", "FBAEMKit",
  "FBLPromises", "FBSDKCoreKit", "FBSDKCoreKit_Basics", "FBSDKLoginKit", "FBSDKShareKit", "file_picker",
  "FirebaseABTesting", "FirebaseAuth", "FirebaseCore", "FirebaseCoreDiagnostics", "FirebaseCoreExtension",
  "FirebaseCoreInternal", "FirebaseCrashlytics", "FirebaseDynamicLinks", "FirebaseFirestore",
  "FirebaseInstallations", "FirebaseMessaging", "FirebaseRemoteConfig", "Flutter", "flutter_inappwebview",
  "flutter_local_notifications", "fluttertoast", "FMDB", "geolocator_apple", "GoogleDataTransport", "GoogleSignIn",
  "GoogleToolboxForMac", "GoogleUtilities", "grpcpp", "GTMAppAuth", "GTMSessionFetcher", "hermes",
  "image_picker_ios", "IQKeyboardManager", "IQKeyboardManagerSwift", "Kingfisher", "leveldb", "Lottie",
  "MBProgressHUD", "nanopb", "OneSignal", "OneSignalCore", "OneSignalExtension", "OneSignalOutcomes", "OpenSSL",
  "OrderedSet", "package_info", "package_info_plus", "path_provider", "path_provider_ios", "Promises", "Protobuf",
  "Reachability", "RealmSwift", "RxCocoa", "RxRelay", "RxSwift", "SDWebImage", "share_plus", "shared_preferences_ios",
  "SnapKit", "sqflite", "Starscream", "SVProgressHUD", "SwiftyGif", "SwiftyJSON", "Toast", "UnityFramework",
  "url_launcher", "url_launcher_ios", "video_player_avfoundation", "wakelock", "webview_flutter_wkwebview",
];

/**
 * Swift packages are named after their repository, not the module on Apple's
 * list. Only packages whose repository name differs need a row.
 */
export const SDK_PACKAGE_ALIASES: Readonly<Record<string, string>> = {
  "firebase-ios-sdk": "FirebaseCore",
  "lottie-ios": "Lottie",
  "lottie-spm": "Lottie",
  "realm-swift": "RealmSwift",
  "googlesignin-ios": "GoogleSignIn",
  "gtm-session-fetcher": "GTMSessionFetcher",
  "appauth-ios": "AppAuth",
  "abseil-cpp-binary": "Abseil",
  "abseil-cpp": "Abseil",
  "grpc-binary": "grpcpp",
  "swift-protobuf": "Protobuf",
  "facebook-ios-sdk": "FBSDKCoreKit",
  "onesignal-ios-sdk": "OneSignal",
  "onesignal-xcframework": "OneSignal",
};

/** Code that suggests a login screen, for the demo account reminder. */
export const SIGN_IN_PATTERNS: readonly RegExp[] = [
  /\bSignInWithAppleButton\b/,
  /\bASAuthorizationAppleIDProvider\b/,
  /\bGIDSignIn\b/,
  /\bLoginManager\b/,
  /\bAuth\.auth\(\)\.signIn\b/,
  /\bsignInWith(Password|Email|OAuth)\b/,
];

/** Sample values left behind in Info.plist. Google's published test AdMob app id leads. */
export const PLACEHOLDER_PLIST_VALUES: readonly RegExp[] = [
  /^ca-app-pub-3940256099942544/,
  /^(YOUR_|REPLACE_|CHANGE_?ME|<YOUR)/i,
  /^FB_APP_ID$/,
];
