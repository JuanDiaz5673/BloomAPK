# Source this file before building: `source env.sh`
# Sets JAVA_HOME + ANDROID_HOME to this project's self-contained tooling
# so builds don't depend on anything on the user's system PATH.
export JAVA_HOME="C:/Projects/BloomAPK/tools/jdk-17.0.18+8"
export ANDROID_HOME="C:/Projects/BloomAPK/tools/android-sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$PATH"
