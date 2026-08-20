use std::io;

use crate::canvas::Canvas;

#[derive(Clone, Debug)]
pub(crate) struct HerdrTarget;

impl HerdrTarget {
    pub(crate) fn from_env(_env: &crate::terminal::SessionEnv) -> Option<Self> {
        None
    }
}

pub(crate) struct Herdr;

impl Herdr {
    pub(crate) fn open(_target: &HerdrTarget, _instance: u64) -> Option<Self> {
        None
    }

    pub(crate) fn cell(&self) -> (u32, u32) {
        (1, 1)
    }

    pub(crate) fn mouse_position_px(
        &self,
        _kind: crate::terminal::MouseKind,
        x: u32,
        y: u32,
        _focused: bool,
        _pixel_mouse: bool,
        _grid: impl FnOnce() -> Option<crate::terminal::WindowSize>,
    ) -> (u32, u32) {
        (x.saturating_sub(1), y.saturating_sub(1))
    }

    pub(crate) fn present(&mut self, _canvas: &Canvas) -> io::Result<usize> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "herdr is unavailable on Windows",
        ))
    }
}
