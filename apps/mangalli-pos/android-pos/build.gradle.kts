plugins {
    id("com.android.application") version "9.2.1" apply false
    id("org.jetbrains.kotlin.android") version "2.2.10" apply false
    id("org.jetbrains.kotlin.kapt") version "2.2.10" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.10" apply false
}

val localBuildRoot = file(
    providers.gradleProperty("mangalliAndroidBuildDir")
        .orElse("${System.getProperty("user.home")}/.gradle/mangalli-android-pos-build")
        .get()
)

layout.buildDirectory.set(localBuildRoot.resolve("root"))

subprojects {
    layout.buildDirectory.set(localBuildRoot.resolve(name))
}
