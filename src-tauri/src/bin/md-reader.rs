#[allow(dead_code, unused_attributes)]
#[path = "../main.rs"]
mod app;

fn main() {
    std::process::exit(app::run_cli(std::env::args()));
}
