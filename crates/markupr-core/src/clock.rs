use std::{
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Copy, Debug)]
pub struct Clock {
    t0_host_ns: u64,
    t0_unix_ms: u64,
}

#[repr(C)]
struct Timebase {
    numer: u32,
    denom: u32,
}
extern "C" {
    fn mach_absolute_time() -> u64;
    fn mach_timebase_info(info: *mut Timebase) -> i32;
}
impl Clock {
    pub fn start() -> Clock {
        Self::from_parts(
            Self::host_now_ns(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        )
    }
    pub fn from_parts(t0_host_ns: u64, t0_unix_ms: u64) -> Self {
        Self {
            t0_host_ns,
            t0_unix_ms,
        }
    }
    pub fn host_now_ns() -> u64 {
        Self::mach_ticks_to_ns(unsafe { mach_absolute_time() })
    }
    pub fn mach_ticks_to_ns(ticks: u64) -> u64 {
        static RATIO: OnceLock<(u32, u32)> = OnceLock::new();
        let &(numer, denom) = RATIO.get_or_init(|| {
            let mut info = Timebase { numer: 0, denom: 0 };
            assert_eq!(unsafe { mach_timebase_info(&mut info) }, 0);
            (info.numer, info.denom)
        });
        (ticks as u128 * numer as u128 / denom as u128) as u64
    }
    pub fn now(&self) -> f64 {
        self.t_from_host_ns(Self::host_now_ns())
    }
    pub fn t_from_host_ns(&self, host_ns: u64) -> f64 {
        (host_ns as i128 - self.t0_host_ns as i128) as f64 / 1e9
    }
    pub fn t_from_unix_ms(&self, unix_ms: u64) -> f64 {
        (unix_ms as i128 - self.t0_unix_ms as i128) as f64 / 1e3
    }
    pub fn t0_host_ns(&self) -> u64 {
        self.t0_host_ns
    }
    pub fn t0_unix_ms(&self) -> u64 {
        self.t0_unix_ms
    }
}
pub fn round_t(t: f64) -> f64 {
    (t * 1000.0).round() / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clock_t_from_host_ns_disagrees_with_now_by_more_than_5_ms() {
        let clock = Clock::start();
        let t = clock.t_from_host_ns(Clock::host_now_ns());
        assert!((clock.now() - t).abs() < 0.005);
        assert!(clock.t_from_host_ns(clock.t0_host_ns() - 1) < 0.0);
    }
}
