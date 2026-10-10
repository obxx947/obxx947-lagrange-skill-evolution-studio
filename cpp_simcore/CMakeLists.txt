cmake_minimum_required(VERSION 3.16)
project(LagrangeBattleSim VERSION 1.0.0 LANGUAGES C CXX)

# 编译选项
set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# 编译标志
if(MSVC)
    add_compile_options(/W3 /O2 /arch:AVX2)
    set(CMAKE_WINDOWS_EXPORT_ALL_SYMBOLS ON)
else()
    add_compile_options(-Wall -Wextra -O3 -march=native -mtune=native)
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        add_compile_options(-g -fno-omit-frame-pointer)
    endif()
endif()

# ============================================================
# 源文件（★ 2026-10-11 修正：原清单里引用的 sim_engine.cpp / fleet.cpp /
#   weapons.cpp / tests/test_engine.cpp / tools/cli_main.cpp 在整个项目里
#   都不存在（属"计划中"文件），会导致 cmake 配置直接失败。
#   现按【实际存在的文件】构建；那些文件将来补上时再加回。）
# ============================================================
set(C_SOURCES
    src/battle_calc.c        # 战斗公式核心库（纯C）
    src/lagrange_battle.c    # 完整战斗引擎（按《战斗机制》全文实现）
)

set(HEADERS
    include/battle_calc.h
    include/sim_engine.hpp   # C++ 头（声明已有，实现源 sim_engine.cpp 待补）
)

# 主库（共享库，供 Python ctypes 调用）
add_library(lagrange_battle SHARED
    ${C_SOURCES}
    ${HEADERS}
)

target_include_directories(lagrange_battle
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/include
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(lagrange_battle PRIVATE m)

# 设置库属性
set_target_properties(lagrange_battle PROPERTIES
    VERSION ${PROJECT_VERSION}
    SOVERSION 1
    OUTPUT_NAME lagrange_battle
    DEBUG_POSTFIX _d
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON
)

# 静态库版本
add_library(lagrange_battle_static STATIC
    ${C_SOURCES}
    ${HEADERS}
)

target_include_directories(lagrange_battle_static
    PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src
)

set_target_properties(lagrange_battle_static PROPERTIES
    OUTPUT_NAME lagrange_battle_static
    DEBUG_POSTFIX _d
)

# 测试可执行文件（公式锁定测试）
option(BUILD_TESTS "Build test executables" ON)
if(BUILD_TESTS)
    enable_testing()

    add_executable(test_battle
        tests/test_calc.c
        src/battle_calc.c
    )
    target_include_directories(test_battle PRIVATE include)
    target_link_libraries(test_battle PRIVATE m)
    add_test(NAME test_battle COMMAND test_battle)
endif()

# 安装规则
install(TARGETS lagrange_battle lagrange_battle_static
    LIBRARY DESTINATION lib
    ARCHIVE DESTINATION lib
)
install(FILES ${HEADERS} DESTINATION include/lagrange)

# 打包配置
set(CPACK_PACKAGE_NAME "LagrangeBattleSim")
set(CPACK_PACKAGE_VERSION ${PROJECT_VERSION})
set(CPACK_PACKAGE_DESCRIPTION "拉格朗日战斗模拟引擎 - C/C++高性能核心")
include(CPack)
