// Windows 发布模式下不弹控制台窗口
// 调试模式下保留控制台方便看 println!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    flowmark_lib::run();
}
