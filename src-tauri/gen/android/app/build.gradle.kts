import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Release signing. The keystore never lives in the repo: locally it sits in
// ~/.mp3fy, in CI it is written from a secret. Without it (a plain clone,
// `make android`) the release build simply stays unsigned — which is enough
// to build, and not enough to install.
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("key.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.morethancoder.mp3fy"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.morethancoder.mp3fy"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        create("release") {
            keystoreProperties["storeFile"]?.let {
                storeFile = file(it as String)
                storePassword = keystoreProperties["password"] as String
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = (keystoreProperties["keyPassword"] ?: keystoreProperties["password"]) as String
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (keystoreProperties["storeFile"] != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            // R8 off on purpose. Nearly all of this APK is the engine's native
            // payload (Python, ffmpeg, yt-dlp), so shrinking the Java side
            // saves a couple of MB out of ~57 — while the engine, Tauri's
            // plugin loading and Jackson are all reflection-driven, which R8
            // cannot see. It shipped a build that installed fine and then died
            // in ZipUtils.unzip with NoClassDefFoundError. Not worth it.
            isMinifyEnabled = false
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
    packaging {
        jniLibs {
            // yt-dlp's Python runtime and ffmpeg ship as .so payloads that have
            // to exist as real files on disk to be executed — compressed-in-APK
            // libraries never get extracted, and the engine can't run.
            useLegacyPackaging = true
        }
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    // The download engine. On desktop mp3fy downloads a yt-dlp binary and runs
    // it; Android forbids executing anything from an app's writable storage, so
    // here yt-dlp, its Python runtime and ffmpeg are shipped inside the APK as
    // native libraries by this library, which is the same one Seal uses.
    val youtubedlAndroid = "0.18.1"
    implementation("io.github.junkfood02.youtubedl-android:library:$youtubedlAndroid")
    implementation("io.github.junkfood02.youtubedl-android:ffmpeg:$youtubedlAndroid")

    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")