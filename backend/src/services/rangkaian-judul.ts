// backend/src/services/rangkaian-judul.ts
import { judulTersamar } from './rangkaian-read.service.js';

/** Judul rangkaian untuk ditampilkan; SELALU disamarkan bila induk tidak boleh dibaca (§4.8). Satu sumber placeholder: judulTersamar (P2). */
export function judulRangkaianTampil(kode: string, judul: string | null | undefined, indukTersamar: boolean): string {
    if (indukTersamar) return judulTersamar(kode);
    const bersih = (judul ?? '').trim();
    return bersih || `Rangkaian ${kode}`;
}
