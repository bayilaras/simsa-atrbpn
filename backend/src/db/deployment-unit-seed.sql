-- Retain organizational settings maintained by administrators on every rerun.
INSERT INTO public.unit_kerja (id, name, description) VALUES
    ('ditjen', 'Direktorat Jenderal Pengadaan Tanah dan Pengembangan Pertanahan', 'Ditjen PTPP'),
    ('sesditjen', 'Sekretariat Direktorat Jenderal', 'SesDitjen')
ON CONFLICT (id) DO NOTHING;
