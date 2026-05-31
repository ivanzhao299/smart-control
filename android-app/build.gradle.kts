// 顶层 Gradle 配置 — 只声明 plugin 版本, 实际 apply 在 app/build.gradle.kts
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
