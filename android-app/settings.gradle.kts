// 仓库源按构建环境切换 (2026-07-27, CI #19 失败根治):
//   - 本地 (国内 mac): dl.google.com 慢/不稳定, 阿里云镜像优先, google() 兜底
//   - CI (GitHub 海外 runner): 阿里云镜像反而慢且瞬断 (#19 就是镜像取
//     viewbinding/material 等 .aar 失败), 直连 google()/mavenCentral() 优先,
//     阿里云降级为兜底
// GitHub Actions 自带 CI=true 环境变量, 本地一般没有。
// 注: pluginManagement 必须是本文件第一个块, 判断只能在块内内联, 不能提公共 val。
pluginManagement {
    repositories {
        if (System.getenv("CI") == null) {
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/central")
            maven("https://maven.aliyun.com/repository/gradle-plugin")
        }
        google()
        mavenCentral()
        gradlePluginPortal()
        if (System.getenv("CI") != null) {
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/central")
            maven("https://maven.aliyun.com/repository/gradle-plugin")
        }
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        if (System.getenv("CI") == null) {
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/central")
        }
        google()
        mavenCentral()
        if (System.getenv("CI") != null) {
            maven("https://maven.aliyun.com/repository/google")
            maven("https://maven.aliyun.com/repository/central")
        }
    }
}

rootProject.name = "JinhuControl"
include(":app")
