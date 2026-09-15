-- Keep the selected official items across letter registration and archiving.
-- Legacy rows stay NULL: a duplicate code or theme does not prove a JRA choice.
ALTER TABLE public.surat_masuk
    ADD COLUMN klasifikasi_item_id integer REFERENCES public.klasifikasi_arsip(id) ON DELETE RESTRICT,
    ADD COLUMN jra_item_id integer REFERENCES public.jadwal_retensi_arsip(id) ON DELETE RESTRICT,
    ADD CONSTRAINT surat_masuk_jra_requires_classification CHECK (jra_item_id IS NULL OR klasifikasi_item_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE public.surat_keluar
    ADD COLUMN klasifikasi_item_id integer REFERENCES public.klasifikasi_arsip(id) ON DELETE RESTRICT,
    ADD COLUMN jra_item_id integer REFERENCES public.jadwal_retensi_arsip(id) ON DELETE RESTRICT,
    ADD CONSTRAINT surat_keluar_jra_requires_classification CHECK (jra_item_id IS NULL OR klasifikasi_item_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX surat_masuk_klasifikasi_item_idx ON public.surat_masuk(klasifikasi_item_id);
CREATE INDEX surat_masuk_jra_item_idx ON public.surat_masuk(jra_item_id);
CREATE INDEX surat_keluar_klasifikasi_item_idx ON public.surat_keluar(klasifikasi_item_id);
CREATE INDEX surat_keluar_jra_item_idx ON public.surat_keluar(jra_item_id);
