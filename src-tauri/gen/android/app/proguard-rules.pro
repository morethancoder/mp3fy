# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# --- mp3fy -------------------------------------------------------------
# Tauri loads plugin classes and their @Command methods by name, and the
# @InvokeArg classes are filled in by Jackson from JSON. R8 sees none of
# that: without these rules the release APK builds fine and then cannot find
# YtdlpPlugin at runtime, which is the whole download engine.
-keep class com.morethancoder.mp3fy.** { *; }

# The engine itself: youtubedl-android maps yt-dlp's JSON onto these classes,
# again reflectively.
-keep class com.yausername.** { *; }
-keepclassmembers class com.yausername.** { *; }

-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
-dontwarn com.fasterxml.jackson.**