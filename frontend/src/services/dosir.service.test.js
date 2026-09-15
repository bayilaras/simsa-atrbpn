import { beforeEach, expect, it, vi } from 'vitest';
import dosirService from './dosir.service';
const api = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
vi.mock('./api', () => ({ default: api }));
beforeEach(() => { api.post.mockReset().mockResolvedValue({data:{id:'d1'}}); api.put.mockReset().mockResolvedValue({data:{id:'d1'}}); });
it('omits the optional blank start date when creating a dosir', async () => {
    await dosirService.create({judul:'QA',tanggalMulai:''}, 'ditjen');
    expect(JSON.parse(JSON.stringify(api.post.mock.calls[0][1]))).toEqual({judul:'QA'});
});
it('sends null to explicitly clear date fields but preserves omitted partial fields', async () => {
    await dosirService.update('d1',{tanggalMulai:'',tanggalSelesai:''});
    expect(api.put).toHaveBeenLastCalledWith('/api/dosir/d1',{tanggalMulai:null,tanggalSelesai:null});
    await dosirService.update('d1',{judul:'Revisi'});
    expect(api.put).toHaveBeenLastCalledWith('/api/dosir/d1',{judul:'Revisi'});
});
