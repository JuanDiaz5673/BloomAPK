# ── Bloom / Capacitor 6 keep rules ──────────────────────────────────
# R8 strips unused classes aggressively; Capacitor + any dynamically-
# loaded plugin needs explicit keep rules or their native bridges get
# obfuscated out and nothing fires at runtime.
-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.plugins.** { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public *;
}
# App itself
-keep class com.bloom.app.** { *; }

# WebView JS bridge reflection — Capacitor pipes calls through this
# so R8 must not obfuscate the annotated plugin methods or their
# parameter types. The rules above cover the plugin classes
# themselves; these protect reflective method invocation.
-keepattributes Signature,*Annotation*,InnerClasses,EnclosingMethod
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
    @com.getcapacitor.annotation.CapacitorPlugin *;
}

# Keep line numbers in release crash reports — tiny size cost, huge
# debuggability win when users surface stack traces.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

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
