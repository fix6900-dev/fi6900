use crate::errors::Fi6900Error;
use anchor_lang::prelude::*;

/// floor(a * b / c) with u128 intermediates.
pub fn mul_div_floor(a: u64, b: u64, c: u64) -> Result<u64> {
    require!(c != 0, Fi6900Error::MathOverflow);
    let num = (a as u128)
        .checked_mul(b as u128)
        .ok_or(Fi6900Error::MathOverflow)?;
    let q = num / (c as u128);
    u64::try_from(q).map_err(|_| error!(Fi6900Error::MathOverflow))
}

/// ceil(a * b / c) with u128 intermediates.
pub fn mul_div_ceil(a: u64, b: u64, c: u64) -> Result<u64> {
    require!(c != 0, Fi6900Error::MathOverflow);
    let num = (a as u128)
        .checked_mul(b as u128)
        .ok_or(Fi6900Error::MathOverflow)?;
    let c = c as u128;
    let q = num / c;
    let q = if num % c == 0 { q } else { q + 1 };
    u64::try_from(q).map_err(|_| error!(Fi6900Error::MathOverflow))
}

/// fee = units * bps / 10_000 (floor)
pub fn fee_amount(units: u64, bps: u16) -> Result<u64> {
    let v = (units as u128)
        .checked_mul(bps as u128)
        .ok_or(Fi6900Error::MathOverflow)?
        / crate::state::BPS_DENOMINATOR;
    u64::try_from(v).map_err(|_| error!(Fi6900Error::MathOverflow))
}

/// Linear Dutch-auction price at `elapsed` of `duration` slots, Q64.64.
/// price = start - (start - end) * elapsed / duration, computed without
/// intermediate overflow: (d/dur)*el + ((d%dur)*el)/dur == floor(d*el/dur).
pub fn linear_price(start: u128, end: u128, elapsed: u64, duration: u64) -> Result<u128> {
    require!(duration != 0, Fi6900Error::InvalidArgument);
    require!(start >= end, Fi6900Error::InvalidArgument);
    let elapsed = elapsed.min(duration) as u128;
    let duration = duration as u128;
    let diff = start - end;
    let q = diff / duration;
    let r = diff % duration;
    let decay = q
        .checked_mul(elapsed)
        .ok_or(Fi6900Error::MathOverflow)?
        .checked_add(
            r.checked_mul(elapsed)
                .ok_or(Fi6900Error::MathOverflow)?
                / duration,
        )
        .ok_or(Fi6900Error::MathOverflow)?;
    start.checked_sub(decay).ok_or_else(|| error!(Fi6900Error::MathOverflow))
}

/// buy_amount = ceil(sell_amount * price / 2^64), where price is Q64.64.
/// Splits price into hi/lo 64-bit halves to avoid 192-bit intermediates.
pub fn buy_amount_for(sell_amount: u64, price_q64: u128) -> Result<u64> {
    let hi = price_q64 >> 64;
    let lo = price_q64 & (u64::MAX as u128);
    let sell = sell_amount as u128;
    let int_part = sell.checked_mul(hi).ok_or(Fi6900Error::MathOverflow)?;
    let frac_num = sell * lo; // < 2^128 since both < 2^64
    let frac_part = frac_num >> 64;
    let frac_rem = frac_num & (u64::MAX as u128);
    let mut total = int_part
        .checked_add(frac_part)
        .ok_or(Fi6900Error::MathOverflow)?;
    if frac_rem != 0 {
        total = total.checked_add(1).ok_or(Fi6900Error::MathOverflow)?;
    }
    u64::try_from(total).map_err(|_| error!(Fi6900Error::MathOverflow))
}

/// Management fee units: supply * bps * dt / (10_000 * 31_557_600)
pub fn mgmt_fee_units(supply: u64, bps: u16, dt_secs: i64) -> Result<u64> {
    if dt_secs <= 0 || supply == 0 || bps == 0 {
        return Ok(0);
    }
    let num = (supply as u128)
        .checked_mul(bps as u128)
        .ok_or(Fi6900Error::MathOverflow)?
        .checked_mul(dt_secs as u128)
        .ok_or(Fi6900Error::MathOverflow)?;
    let den = crate::state::BPS_DENOMINATOR
        .checked_mul(crate::state::SECONDS_PER_YEAR)
        .ok_or(Fi6900Error::MathOverflow)?;
    u64::try_from(num / den).map_err(|_| error!(Fi6900Error::MathOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn price_decays_linearly() {
        let start = 2u128 << 64;
        let end = 1u128 << 64;
        assert_eq!(linear_price(start, end, 0, 100).unwrap(), start);
        assert_eq!(linear_price(start, end, 100, 100).unwrap(), end);
        assert_eq!(linear_price(start, end, 50, 100).unwrap(), (3u128 << 64) / 2);
        assert_eq!(linear_price(start, end, 150, 100).unwrap(), end);
    }

    #[test]
    fn buy_amount_ceils() {
        let one = 1u128 << 64;
        assert_eq!(buy_amount_for(1000, one).unwrap(), 1000);
        assert_eq!(buy_amount_for(1000, one / 2).unwrap(), 500);
        assert_eq!(buy_amount_for(1001, one / 2).unwrap(), 501);
        assert_eq!(buy_amount_for(3, one / 3 + 1).unwrap(), 2);
        assert_eq!(buy_amount_for(1000, 5 * one).unwrap(), 5000);
    }

    #[test]
    fn mul_div() {
        assert_eq!(mul_div_ceil(10, 3, 4).unwrap(), 8);
        assert_eq!(mul_div_floor(10, 3, 4).unwrap(), 7);
        assert_eq!(mul_div_ceil(u64::MAX, u64::MAX, u64::MAX).unwrap(), u64::MAX);
    }
}

/// floor(a * 2^64 / c) with a 256-bit intermediate (binary long division), i.e. the
/// Q64.64 ratio a / c. Errors if the quotient does not fit in u128 or c == 0.
pub fn ratio_q64(a: u128, c: u128) -> Result<u128> {
    require!(c != 0, Fi6900Error::MathOverflow);
    // N = a << 64 as 256 bits: hi = a >> 64, lo = a << 64
    let n_hi: u128 = a >> 64;
    let n_lo: u128 = a << 64;
    let mut rem: u128 = 0;
    let mut q: u128 = 0;
    for i in (0..256u32).rev() {
        let bit = if i >= 128 { (n_hi >> (i - 128)) & 1 } else { (n_lo >> i) & 1 };
        let overflow = rem >> 127 != 0;
        rem = (rem << 1) | bit;
        if overflow || rem >= c {
            rem = rem.wrapping_sub(c);
            require!(i < 128, Fi6900Error::MathOverflow);
            q |= 1u128 << i;
        }
    }
    Ok(q)
}

/// |new - old| * 10_000 / old in bps (u128 math, ceil so a tiny move never rounds to zero).
pub fn move_bps(old: u128, new: u128) -> Result<u128> {
    require!(old != 0, Fi6900Error::MathOverflow);
    let diff = if new >= old { new - old } else { old - new };
    let num = diff
        .checked_mul(crate::state::BPS_DENOMINATOR)
        .ok_or(Fi6900Error::MathOverflow)?;
    let q = num / old;
    Ok(if num % old == 0 { q } else { q + 1 })
}

/// fair * (10_000 - discount_bps) / 10_000 — the lowest acceptable auction end price.
pub fn min_end_price(fair_q64: u128, discount_bps: u16) -> Result<u128> {
    let keep = crate::state::BPS_DENOMINATOR - (discount_bps as u128).min(crate::state::BPS_DENOMINATOR);
    let num = fair_q64.checked_mul(keep).ok_or(Fi6900Error::MathOverflow)?;
    Ok(num / crate::state::BPS_DENOMINATOR)
}

#[cfg(test)]
mod bound_tests {
    use super::*;

    #[test]
    fn ratio_q64_matches_simple_cases() {
        let one = 1u128 << 64;
        assert_eq!(ratio_q64(5, 5).unwrap(), one);
        assert_eq!(ratio_q64(1, 2).unwrap(), one / 2);
        assert_eq!(ratio_q64(3 * one, one).unwrap(), 3 * one);
        // large numerator (price > 2^64) still works
        assert_eq!(ratio_q64(10 * one, 4 * one).unwrap(), (one / 2) * 5);
        assert!(ratio_q64(1u128 << 100, 1).is_err()); // quotient 2^164 does not fit
        assert!(ratio_q64(1, 0).is_err());
    }

    #[test]
    fn move_bps_and_bound() {
        assert_eq!(move_bps(1000, 1200).unwrap(), 2000);
        assert_eq!(move_bps(1000, 800).unwrap(), 2000);
        assert_eq!(move_bps(1000, 1001).unwrap(), 10);
        assert_eq!(move_bps(3, 4).unwrap(), 3334);
        assert_eq!(min_end_price(10_000, 500).unwrap(), 9_500);
        assert_eq!(min_end_price(10_000, 0).unwrap(), 10_000);
    }
}
