import express from 'express';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';
import { allowedSecurityClassifications } from '../services/record-access.service';

const mocks=vi.hoisted(() => ({
    user:{id:'qa-reader',role:'admin_unit',unitKerjaId:'ditjen' as string|null},
    service:{findAll:vi.fn(),getOverdue:vi.fn(),getStats:vi.fn(),findById:vi.fn(),getHistoryByArsipId:vi.fn(),getHistoryByLocationId:vi.fn()},
}));
vi.mock('../middlewares/auth.middleware',() => ({authMiddleware:(req:any,_res:any,next:any) => {req.user={...mocks.user};next();}}));
vi.mock('../middlewares/rate-limiter.middleware',() => ({sensitiveLimiter:(_req:any,_res:any,next:any) => next()}));
vi.mock('../services/archive-lending.service',() => ({archiveLendingService:mocks.service}));
vi.mock('../services/storage-location.service',() => ({storageLocationService:{}}));
import router from '../routes/archive-lending.routes';
const app=express();
app.use(express.json());
app.use('/lending',router);
const recordId='33333333-3333-4333-8333-333333333335';
beforeEach(() => {
    vi.clearAllMocks();
    mocks.service.findAll.mockResolvedValue({data:[],pagination:{total:0}});
    mocks.service.getOverdue.mockResolvedValue([]);
    mocks.service.getStats.mockResolvedValue({total:0});
    mocks.service.findById.mockResolvedValue(null);
    mocks.service.getHistoryByArsipId.mockResolvedValue([]);
    mocks.service.getHistoryByLocationId.mockResolvedValue([]);
});

it.each(['admin_unit','staff','auditor','super_admin'])('uses the authoritative %s classification policy on all lending reads',async role => {
    mocks.user.role=role;
    mocks.user.unitKerjaId=role==='super_admin'?null:'ditjen';
    const classes=allowedSecurityClassifications(mocks.user);
    const query={unitKerjaId:'ditjen',securityClassifications:'rahasia,sangat_rahasia'};
    await request(app).get('/lending').query(query).expect(200);
    expect(mocks.service.findAll).toHaveBeenCalledWith(expect.objectContaining({unitKerjaId:'ditjen',securityClassifications:classes}));
    await request(app).get('/lending/overdue').query(query).expect(200);
    expect(mocks.service.getOverdue).toHaveBeenCalledWith('ditjen',classes);
    await request(app).get('/lending/stats').query(query).expect(200);
    expect(mocks.service.getStats).toHaveBeenCalledWith('ditjen',classes);
    await request(app).get(`/lending/${recordId}`).query(query).expect(404);
    expect(mocks.service.findById).toHaveBeenCalledWith(recordId,'ditjen',classes);
    await request(app).get(`/lending/arsip/${recordId}`).query(query).expect(200);
    expect(mocks.service.getHistoryByArsipId).toHaveBeenCalledWith(recordId,'ditjen',classes);
    await request(app).get(`/lending/location/${recordId}`).query(query).expect(200);
    expect(mocks.service.getHistoryByLocationId).toHaveBeenCalledWith(recordId,'ditjen',classes);
});
