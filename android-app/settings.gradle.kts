pluginManagement {
    repositories {
        // 国内镜像优先 — dl.google.com 在中国大陆慢/不稳定, 阿里云镜像快得多
        // 本地 mac 构建经常因为网络慢卡在 aapt2 下载. 优先阿里云, fallback google() 兜底
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/central")
        maven("https://maven.aliyun.com/repository/gradle-plugin")
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/central")
        google()
        mavenCentral()
    }
}

rootProject.name = "JinhuControl"
include(":app")
