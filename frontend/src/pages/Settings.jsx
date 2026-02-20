import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { settingsService } from '@/services/settings.service';
import { User, Building2, FileText, Save, Loader2, Settings2 } from 'lucide-react';

export default function Settings() {
    const { user, canWrite } = useAuth();
    const { toast } = useToast();
    const isAdmin = canWrite();

    const [activeTab, setActiveTab] = useState('profile');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Profile state
    const [profile, setProfile] = useState({
        name: '',
        email: '',
        image: '',
    });

    // Unit Kerja state
    const [unitKerjaList, setUnitKerjaList] = useState([]);
    const [selectedUnitKerja, setSelectedUnitKerja] = useState(null);
    const [unitKerjaForm, setUnitKerjaForm] = useState({
        name: '',
        description: '',
        driveFolderId: '',
        driveUploadFolderId: '',
    });

    // Surat Templates state
    const [templates, setTemplates] = useState({
        masukFormat: '{noUrut}/SM/{tahun}',
        keluarFormat: '{noUrut}/{naskahDinas}/{bulan}/{tahun}',
    });

    // Load data based on tab
    useEffect(() => {
        loadTabData();
    }, [activeTab]);

    // Initialize with user data
    useEffect(() => {
        if (user) {
            setProfile({
                name: user.name || '',
                email: user.email || '',
                image: user.image || '',
            });
        }
    }, [user]);

    const loadTabData = async () => {
        setLoading(true);
        try {
            switch (activeTab) {
                case 'unit-kerja':
                    const units = await settingsService.getAllUnitKerja();
                    setUnitKerjaList(units);
                    break;
                case 'templates':
                    const tmpl = await settingsService.getSuratTemplates();
                    setTemplates(tmpl);
                    break;
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveProfile = async () => {
        setSaving(true);
        try {
            await settingsService.updateProfile({
                name: profile.name,
                image: profile.image,
            });
            toast({
                title: 'Berhasil',
                description: 'Profil berhasil diperbarui',
            });
        } catch (error) {
            console.error('Profile update error:', error);
            toast({
                title: 'Error',
                description: error?.message || 'Gagal memperbarui profil. Silakan coba lagi.',
                variant: 'destructive',
            });
        } finally {
            setSaving(false);
        }
    };

    const handleSelectUnitKerja = (unit) => {
        setSelectedUnitKerja(unit);
        setUnitKerjaForm({
            name: unit.name || '',
            description: unit.description || '',
            driveFolderId: unit.driveFolderId || '',
            driveUploadFolderId: unit.driveUploadFolderId || '',
        });
    };

    const handleSaveUnitKerja = async () => {
        if (!selectedUnitKerja) return;
        setSaving(true);
        try {
            await settingsService.updateUnitKerja(selectedUnitKerja.id, unitKerjaForm);
            toast({
                title: 'Berhasil',
                description: 'Unit kerja berhasil diperbarui',
            });
            loadTabData();
        } catch (error) {
            toast({
                title: 'Error',
                description: error?.message || 'Gagal memperbarui unit kerja',
                variant: 'destructive',
            });
        } finally {
            setSaving(false);
        }
    };

    const handleSaveTemplates = async () => {
        setSaving(true);
        try {
            await settingsService.updateSuratTemplates(templates);
            toast({
                title: 'Berhasil',
                description: 'Template surat berhasil diperbarui',
            });
        } catch (error) {
            toast({
                title: 'Error',
                description: error?.message || 'Gagal memperbarui template',
                variant: 'destructive',
            });
        } finally {
            setSaving(false);
        }
    };

    const getInitials = (name) => {
        return name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U';
    };

    return (
        <div className="space-y-6">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 text-white shadow-xl">
                <div className="absolute top-0 right-0 -mr-20 -mt-20 h-96 w-96 rounded-full bg-indigo-500/30 blur-3xl"></div>
                <div className="absolute bottom-0 left-0 -ml-20 -mb-20 h-64 w-64 rounded-full bg-blue-500/20 blur-3xl"></div>
                <div className="relative p-8">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 shadow-inner">
                            <Settings2 className="h-8 w-8 text-white" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Pengaturan</h1>
                            <p className="text-blue-100/80 text-lg">
                                Kelola profil, unit kerja, dan template surat
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                <TabsList className={`bg-white/50 backdrop-blur-sm border border-slate-200/60 p-1 h-auto rounded-xl shadow-sm grid w-full gap-1 ${isAdmin ? 'grid-cols-3' : 'grid-cols-1'}`}>
                    <TabsTrigger
                        value="profile"
                        className="data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-lg py-2.5 transition-all duration-200"
                    >
                        <User className="h-4 w-4 mr-2" />
                        <span>Profil</span>
                    </TabsTrigger>
                    {isAdmin && (
                        <>
                            <TabsTrigger
                                value="unit-kerja"
                                className="data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-lg py-2.5 transition-all duration-200"
                            >
                                <Building2 className="h-4 w-4 mr-2" />
                                <span>Unit Kerja</span>
                            </TabsTrigger>
                            <TabsTrigger
                                value="templates"
                                className="data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-lg py-2.5 transition-all duration-200"
                            >
                                <FileText className="h-4 w-4 mr-2" />
                                <span>Template</span>
                            </TabsTrigger>
                        </>
                    )}
                </TabsList>

                {/* Profile Tab */}
                <TabsContent value="profile" className="mt-0">
                    <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
                        <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
                            <CardTitle className="text-xl text-slate-800">Profil Pengguna</CardTitle>
                            <CardDescription className="text-slate-500">
                                Kelola informasi profil dan foto Anda
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center gap-6">
                                <Avatar className="h-20 w-20">
                                    <AvatarImage src={profile.image} alt={profile.name} />
                                    <AvatarFallback className="text-lg">
                                        {getInitials(profile.name)}
                                    </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 space-y-2">
                                    <Label htmlFor="image">URL Foto Profil</Label>
                                    <Input
                                        id="image"
                                        placeholder="https://example.com/photo.jpg"
                                        value={profile.image}
                                        onChange={(e) => setProfile({ ...profile, image: e.target.value })}
                                    />
                                </div>
                            </div>

                            <Separator />

                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="name">Nama Lengkap</Label>
                                    <Input
                                        id="name"
                                        value={profile.name}
                                        onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="email">Email</Label>
                                    <Input
                                        id="email"
                                        value={profile.email}
                                        disabled
                                        className="bg-muted"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Email tidak dapat diubah (dari Google)
                                    </p>
                                </div>
                            </div>

                            <div className="flex justify-end">
                                <Button onClick={handleSaveProfile} disabled={saving}>
                                    {saving ? (
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    ) : (
                                        <Save className="h-4 w-4 mr-2" />
                                    )}
                                    Simpan Profil
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Unit Kerja Tab (Admin Only) */}
                {isAdmin && (
                    <TabsContent value="unit-kerja" className="mt-0">
                        <div className="grid gap-6 md:grid-cols-3">
                            {/* Unit List */}
                            <Card className="md:col-span-1 border-slate-200/60 shadow-sm hover:shadow-md transition-all duration-200 h-fit">
                                <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
                                    <CardTitle className="text-lg text-slate-800">Daftar Unit Kerja</CardTitle>
                                </CardHeader>
                                <CardContent className="p-2">
                                    {loading ? (
                                        <div className="space-y-2 p-2">
                                            {[...Array(5)].map((_, i) => (
                                                <Skeleton key={i} className="h-10 w-full rounded-md" />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="space-y-1 max-h-[500px] overflow-auto pr-1">
                                            {unitKerjaList.map((unit) => (
                                                <button
                                                    key={unit.id}
                                                    onClick={() => handleSelectUnitKerja(unit)}
                                                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all duration-200 flex items-center justify-between group ${selectedUnitKerja?.id === unit.id
                                                        ? 'bg-blue-50 text-blue-700 font-medium'
                                                        : 'hover:bg-slate-50 text-slate-600'
                                                        }`}
                                                >
                                                    <span className="truncate">{unit.name}</span>
                                                    {unit.unitType && (
                                                        <Badge
                                                            variant="outline"
                                                            className={`text-[10px] px-1.5 py-0.5 h-auto ${selectedUnitKerja?.id === unit.id
                                                                ? 'border-blue-200 bg-blue-100 text-blue-700'
                                                                : 'text-slate-500 border-slate-200 group-hover:border-slate-300'
                                                                }`}
                                                        >
                                                            {unit.unitType}
                                                        </Badge>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Unit Details */}
                            <Card className="md:col-span-2 border-slate-200/60 shadow-sm hover:shadow-md transition-all duration-200">
                                <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <CardTitle className="text-lg text-slate-800">Detail Unit Kerja</CardTitle>
                                            <CardDescription className="text-slate-500">
                                                {selectedUnitKerja
                                                    ? `Mengedit unit: ${selectedUnitKerja.name}`
                                                    : 'Pilih unit kerja untuk mengedit'}
                                            </CardDescription>
                                        </div>
                                        {selectedUnitKerja && (
                                            <Badge variant="secondary" className="font-mono text-xs">
                                                ID: {selectedUnitKerja.id}
                                            </Badge>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    {selectedUnitKerja ? (
                                        <div className="space-y-6">
                                            <div className="space-y-2">
                                                <Label className="text-slate-700">Nama Unit</Label>
                                                <Input
                                                    value={unitKerjaForm.name}
                                                    onChange={(e) =>
                                                        setUnitKerjaForm({ ...unitKerjaForm, name: e.target.value })
                                                    }
                                                    className="border-slate-200 focus:border-blue-400 focus:ring-blue-400/20"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-slate-700">Deskripsi</Label>
                                                <Textarea
                                                    value={unitKerjaForm.description}
                                                    onChange={(e) =>
                                                        setUnitKerjaForm({ ...unitKerjaForm, description: e.target.value })
                                                    }
                                                    rows={3}
                                                    className="border-slate-200 focus:border-blue-400 focus:ring-blue-400/20 resize-none"
                                                />
                                            </div>

                                            <div className="space-y-4 rounded-xl bg-slate-50 p-4 border border-slate-100">
                                                <h4 className="text-sm font-medium text-slate-700 flex items-center gap-2">
                                                    <div className="h-1.5 w-1.5 rounded-full bg-blue-500"></div>
                                                    Konfigurasi Google Drive
                                                </h4>
                                                <div className="grid gap-4">
                                                    <div className="space-y-2">
                                                        <Label className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Folder ID (Arsip)</Label>
                                                        <Input
                                                            value={unitKerjaForm.driveFolderId}
                                                            onChange={(e) =>
                                                                setUnitKerjaForm({ ...unitKerjaForm, driveFolderId: e.target.value })
                                                            }
                                                            placeholder="ID folder untuk penyimpanan arsip"
                                                            className="font-mono text-sm bg-white border-slate-200"
                                                        />
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Upload Folder ID</Label>
                                                        <Input
                                                            value={unitKerjaForm.driveUploadFolderId}
                                                            onChange={(e) =>
                                                                setUnitKerjaForm({
                                                                    ...unitKerjaForm,
                                                                    driveUploadFolderId: e.target.value,
                                                                })
                                                            }
                                                            placeholder="ID folder untuk upload sementara"
                                                            className="font-mono text-sm bg-white border-slate-200"
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex justify-end pt-2">
                                                <Button
                                                    onClick={handleSaveUnitKerja}
                                                    disabled={saving}
                                                    className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow transition-all"
                                                >
                                                    {saving ? (
                                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                    ) : (
                                                        <Save className="h-4 w-4 mr-2" />
                                                    )}
                                                    Simpan Perubahan
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-64 text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                                            <Building2 className="h-12 w-12 mb-3 text-slate-300" />
                                            <p>Pilih unit kerja dari daftar di sebelah kiri</p>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>
                )}

                {/* Templates Tab (Admin Only) */}
                {isAdmin && (
                    <TabsContent value="templates" className="mt-0">
                        <Card className="border-slate-200/60 shadow-sm hover:shadow-md transition-all duration-200">
                            <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
                                <CardTitle className="text-xl text-slate-800">Template Nomor Surat</CardTitle>
                                <CardDescription className="text-slate-500">
                                    Konfigurasi format penomoran surat otomatis
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-8 pt-6">
                                {loading ? (
                                    <div className="space-y-6">
                                        <Skeleton className="h-24 rounded-xl" />
                                        <Skeleton className="h-24 rounded-xl" />
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid gap-8 md:grid-cols-2">
                                            <div className="space-y-4 p-5 rounded-xl border border-slate-100 bg-slate-50/50">
                                                <div className="space-y-2">
                                                    <Label className="text-slate-700 font-medium">Format Nomor Surat Masuk</Label>
                                                    <Input
                                                        value={templates.masukFormat}
                                                        onChange={(e) =>
                                                            setTemplates({ ...templates, masukFormat: e.target.value })
                                                        }
                                                        placeholder="{noUrut}/SM/{tahun}"
                                                        className="font-mono bg-white border-slate-200 focus:border-blue-400 focus:ring-blue-400/20"
                                                    />
                                                    <p className="text-xs text-slate-500 flex items-center gap-2 mt-2">
                                                        <span className="font-semibold text-slate-600">Preview:</span>
                                                        <span className="bg-slate-100 px-2 py-0.5 rounded font-mono text-slate-700">001/SM/2026</span>
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="space-y-4 p-5 rounded-xl border border-slate-100 bg-slate-50/50">
                                                <div className="space-y-2">
                                                    <Label className="text-slate-700 font-medium">Format Nomor Surat Keluar</Label>
                                                    <Input
                                                        value={templates.keluarFormat}
                                                        onChange={(e) =>
                                                            setTemplates({ ...templates, keluarFormat: e.target.value })
                                                        }
                                                        placeholder="{noUrut}/{naskahDinas}/{bulan}/{tahun}"
                                                        className="font-mono bg-white border-slate-200 focus:border-blue-400 focus:ring-blue-400/20"
                                                    />
                                                    <p className="text-xs text-slate-500 flex items-center gap-2 mt-2">
                                                        <span className="font-semibold text-slate-600">Preview:</span>
                                                        <span className="bg-slate-100 px-2 py-0.5 rounded font-mono text-slate-700">001/ND/02/2026</span>
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-4">
                                            <h4 className="text-sm font-semibold text-blue-800 mb-2">Variabel yang Tersedia</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {['{noUrut}', '{tahun}', '{bulan}', '{unitKerja}', '{naskahDinas}'].map((v) => (
                                                    <Badge key={v} variant="secondary" className="bg-blue-100/50 text-blue-700 border-blue-200 hover:bg-blue-100 font-mono">
                                                        {v}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="flex justify-end pt-4">
                                            <Button
                                                onClick={handleSaveTemplates}
                                                disabled={saving}
                                                className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow transition-all"
                                            >
                                                {saving ? (
                                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                ) : (
                                                    <Save className="h-4 w-4 mr-2" />
                                                )}
                                                Simpan Template
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}
