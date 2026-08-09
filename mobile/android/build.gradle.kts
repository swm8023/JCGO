plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.21" apply false
}

val externalBuildRoot = providers.gradleProperty("jcgoBuildRoot")
    .orElse(System.getenv("JCGO_ANDROID_BUILD_ROOT") ?: "")
    .get()

if (externalBuildRoot.isNotBlank()) {
    val rootBuildDir = file(externalBuildRoot)
    layout.buildDirectory.set(rootBuildDir.resolve("root"))

    subprojects {
        val projectName = path.removePrefix(":").replace(':', '_').ifBlank { "root" }
        layout.buildDirectory.set(rootBuildDir.resolve(projectName))
    }
}
