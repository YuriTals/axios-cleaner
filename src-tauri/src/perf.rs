//! Contadores de desempenho do Windows (PDH), os mesmos do Gerenciador de Tarefas:
//!   - GPU:   soma da utilizacao dos motores 3D de todos os processos
//!   - Disco: atividade do disco (100 - % de tempo ocioso)

use windows_sys::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhOpenQueryW,
    PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE,
};

const PDH_MORE_DATA: u32 = 0x800007D2;

pub struct Perf {
    query: isize,
    gpu: Option<isize>,
    disk_idle: Option<isize>,
}

// Os handles do PDH sao usados apenas atras de um Mutex.
unsafe impl Send for Perf {}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

impl Perf {
    pub fn new() -> Self {
        let mut query = 0isize;
        unsafe {
            if PdhOpenQueryW(std::ptr::null(), 0, &mut query as *mut isize as _) != 0 {
                return Perf { query: 0, gpu: None, disk_idle: None };
            }
        }
        let add = |path: &str| -> Option<isize> {
            let mut counter = 0isize;
            let p = wide(path);
            let ok = unsafe { PdhAddEnglishCounterW(query as _, p.as_ptr(), 0, &mut counter as *mut isize as _) };
            (ok == 0).then_some(counter)
        };
        let perf = Perf {
            query,
            gpu: add("\\GPU Engine(*engtype_3D)\\Utilization Percentage"),
            disk_idle: add("\\PhysicalDisk(_Total)\\% Idle Time"),
        };
        unsafe { PdhCollectQueryData(query as _) };
        perf
    }

    /// Soma dos valores de um contador (com coringa ou nao).
    fn sum(&self, counter: isize) -> Option<f64> {
        unsafe {
            let (mut size, mut count) = (0u32, 0u32);
            let r = PdhGetFormattedCounterArrayW(counter as _, PDH_FMT_DOUBLE, &mut size, &mut count, std::ptr::null_mut());
            if r != PDH_MORE_DATA || size == 0 {
                return None;
            }
            let n = size as usize / std::mem::size_of::<PDH_FMT_COUNTERVALUE_ITEM_W>() + 1;
            let mut buf: Vec<PDH_FMT_COUNTERVALUE_ITEM_W> = Vec::with_capacity(n);
            if PdhGetFormattedCounterArrayW(counter as _, PDH_FMT_DOUBLE, &mut size, &mut count, buf.as_mut_ptr()) != 0 {
                return None;
            }
            buf.set_len(count as usize);
            Some(buf.iter().map(|i| i.FmtValue.Anonymous.doubleValue).filter(|v| v.is_finite()).sum())
        }
    }

    /// Retorna (gpu %, disco %).
    pub fn sample(&mut self) -> (Option<f32>, Option<f32>) {
        if self.query == 0 {
            return (None, None);
        }
        unsafe { PdhCollectQueryData(self.query as _) };
        let gpu = self.gpu.and_then(|c| self.sum(c)).map(|v| v.clamp(0.0, 100.0) as f32);
        let disk = self.disk_idle.and_then(|c| self.sum(c)).map(|idle| (100.0 - idle).clamp(0.0, 100.0) as f32);
        (gpu, disk)
    }
}
