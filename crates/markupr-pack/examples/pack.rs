use markupr_core::{Config, PackDir};
use markupr_pack::{build_pack, AudioSource, PackError, PackOptions};
fn main() -> Result<(), PackError> {
    let mut args = std::env::args().skip(1);
    let dir = args
        .next()
        .ok_or("usage: pack <pack dir> [--fast] [--audio-source mic|system]")?;
    let mut opts = PackOptions {
        fast: false,
        audio_source: AudioSource::Mic,
    };
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--fast" => opts.fast = true,
            "--audio-source" => {
                opts.audio_source = match args.next().as_deref() {
                    Some("mic") => AudioSource::Mic,
                    Some("system") => AudioSource::System,
                    _ => return Err("--audio-source must be mic or system".into()),
                }
            }
            _ => return Err(format!("unknown argument: {arg}").into()),
        }
    }
    let report = build_pack(&PackDir::open(dir)?, &Config::load()?, &opts)?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
