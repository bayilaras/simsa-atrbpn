import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Filter, Users, Edit2, UserX, MoreHorizontal, Loader2, AlertTriangle, Shield, Building2, UserPlus, Mail, CheckCircle2, Ban, Eye, EyeOff, Lock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuLabel
} from '@/components/ui/dropdown-menu';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/context/AuthContext';
import userManagementService from '@/services/user-management.service';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const ROLE_COLORS = {
    'super_admin': 'bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300 border-red-200',
    'admin_dirjen': 'bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-200',
    'admin_sesditjen': 'bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300 border-green-200',
    'staff': 'bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-200',
    'user': 'bg-muted text-foreground border-border',
};

const ROLE_LABELS = {
    'super_admin': 'Super Admin',
    'admin_dirjen': 'Admin Dirjen',
    'admin_sesditjen': 'Admin Sesditjen',
    'staff': 'Staff',
    'user': 'User',
};

export default function UserManagement() {
    const { user: currentUser, hasRole } = useAuth();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Filters
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [unitKerjaFilter, setUnitKerjaFilter] = useState('all');

    // Dropdown data
    const [roles, setRoles] = useState([]);
    const [unitKerjaList, setUnitKerjaList] = useState([]);

    // Pagination
    const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });

    // Edit modal
    const [editOpen, setEditOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [editData, setEditData] = useState({ role: '', unitKerjaId: '', isActive: true, jabatan: '', nip: '' });
    const [saving, setSaving] = useState(false);

    // Add user dialog
    const [addOpen, setAddOpen] = useState(false);
    const [addData, setAddData] = useState({ email: '', name: '', role: 'user', unitKerjaId: '', jabatan: '', nip: '', password: '' });
    const [creating, setCreating] = useState(false);
    const [addError, setAddError] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    // Check admin access
    const isAdmin = hasRole(['super_admin']);

    // Load initial data
    useEffect(() => {
        if (isAdmin) {
            loadDropdownData();
            loadUsers();
        }
    }, [isAdmin]);

    // Reload when filters change
    useEffect(() => {
        if (isAdmin) {
            const timer = setTimeout(() => loadUsers(), 300);
            return () => clearTimeout(timer);
        }
    }, [search, roleFilter, unitKerjaFilter, pagination.page]);

    // Applying a filter must restart from the first page
    const applyFilter = (setter) => (value) => {
        setter(value);
        setPagination(prev => ({ ...prev, page: 1 }));
    };

    const loadDropdownData = async () => {
        try {
            const [rolesRes, unitKerjaRes] = await Promise.all([
                userManagementService.getRoles(),
                userManagementService.getUnitKerja(),
            ]);
            setRoles(rolesRes.data || []);
            setUnitKerjaList(unitKerjaRes.data || []);
        } catch (err) {
            console.error('Failed to load dropdown data:', err);
        }
    };

    const loadUsers = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const params = {
                page: pagination.page,
                limit: pagination.limit,
            };
            if (search) params.search = search;
            if (roleFilter && roleFilter !== 'all') params.role = roleFilter;
            if (unitKerjaFilter && unitKerjaFilter !== 'all') params.unitKerjaId = unitKerjaFilter;

            const response = await userManagementService.listUsers(params);
            setUsers(response.data || []);
            setPagination(prev => ({
                ...prev,
                total: response.pagination?.total || 0,
                totalPages: response.pagination?.totalPages || 0,
            }));
        } catch (err) {
            console.error('Failed to load users:', err);
            setError('Gagal memuat data users');
        } finally {
            setLoading(false);
        }
    }, [search, roleFilter, unitKerjaFilter, pagination.page, pagination.limit]);

    const handleEdit = (user) => {
        setEditingUser(user);
        setEditData({
            role: user.role,
            unitKerjaId: user.unitKerjaId || '',
            isActive: user.isActive,
            jabatan: user.jabatan || '',
            nip: user.nip || '',
        });
        setEditOpen(true);
    };

    const handleSave = async () => {
        if (!editingUser) return;

        try {
            setSaving(true);
            await userManagementService.updateUser(editingUser.id, {
                role: editData.role,
                unitKerjaId: editData.unitKerjaId || null,
                isActive: editData.isActive,
                jabatan: editData.jabatan || null,
                nip: editData.nip || null,
            });
            setEditOpen(false);
            loadUsers();
        } catch (err) {
            console.error('Failed to update user:', err);
            alert(err.response?.data?.error || 'Gagal mengupdate user');
        } finally {
            setSaving(false);
        }
    };

    const handleAddUser = () => {
        setAddData({ email: '', name: '', role: 'user', unitKerjaId: '', jabatan: '', nip: '', password: '' });
        setAddError('');
        setShowPassword(false);
        setAddOpen(true);
    };

    const handleCreateUser = async () => {
        if (!addData.email || !addData.name) {
            setAddError('Email dan nama wajib diisi');
            return;
        }
        if (addData.password && addData.password.length < 8) {
            setAddError('Password minimal 8 karakter');
            return;
        }
        try {
            setCreating(true);
            setAddError('');
            await userManagementService.createUser({
                email: addData.email,
                name: addData.name,
                role: addData.role,
                unitKerjaId: addData.unitKerjaId || null,
                jabatan: addData.jabatan || null,
                nip: addData.nip || null,
                ...(addData.password ? { password: addData.password } : {}),
            });
            setAddOpen(false);
            loadUsers();
        } catch (err) {
            console.error('Failed to create user:', err);
            setAddError(err.message || 'Gagal membuat user baru');
        } finally {
            setCreating(false);
        }
    };

    const handleDeactivate = async (user) => {
        if (user.id === currentUser?.id) {
            alert('Tidak dapat menonaktifkan akun sendiri');
            return;
        }

        if (!window.confirm(`Yakin ingin menonaktifkan user ${user.name || user.email}?`)) {
            return;
        }

        try {
            await userManagementService.deactivateUser(user.id);
            loadUsers();
        } catch (err) {
            console.error('Failed to deactivate user:', err);
            alert(err.response?.data?.error || 'Gagal menonaktifkan user');
        }
    };

    const handleActivate = async (user) => {
        if (!window.confirm(`Yakin ingin mengaktifkan user ${user.name || user.email}?`)) {
            return;
        }

        try {
            await userManagementService.updateUser(user.id, { isActive: true });
            loadUsers();
        } catch (err) {
            console.error('Failed to activate user:', err);
            alert(err.response?.data?.error || 'Gagal mengaktifkan user');
        }
    };

    const getInitials = (name) => {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    const getAvatarColor = (name) => {
        const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-orange-500'];
        if (!name) return 'bg-slate-500';
        const index = name.charCodeAt(0) % colors.length;
        return colors[index];
    };

    // Password strength calculator
    const passwordStrength = useMemo(() => {
        const pw = addData.password || '';
        if (!pw) return { score: 0, label: '', color: '' };
        let score = 0;
        if (pw.length >= 8) score++;
        if (pw.length >= 12) score++;
        if (/[A-Z]/.test(pw)) score++;
        if (/[a-z]/.test(pw)) score++;
        if (/[0-9]/.test(pw)) score++;
        if (/[^A-Za-z0-9]/.test(pw)) score++;

        if (score <= 2) return { score: 1, label: 'Lemah', color: 'bg-red-500' };
        if (score <= 3) return { score: 2, label: 'Sedang', color: 'bg-yellow-500' };
        if (score <= 4) return { score: 3, label: 'Kuat', color: 'bg-blue-500' };
        return { score: 4, label: 'Sangat Kuat', color: 'bg-green-500' };
    }, [addData.password]);

    // Access denied for non-admins
    if (!isAdmin) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 animate-in fade-in zoom-in duration-500">
                <div className="p-4 bg-red-100 dark:bg-red-500/15 rounded-full">
                    <Shield className="h-16 w-16 text-red-600" />
                </div>
                <div className="text-center space-y-2">
                    <h2 className="text-3xl font-bold text-foreground">Akses Ditolak</h2>
                    <p className="text-muted-foreground text-lg">Hanya Super Admin yang dapat mengakses halaman ini</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-500/15 rounded-lg">
                            <Users className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        User Management
                    </h1>
                    <p className="text-muted-foreground">
                        Kelola pengguna, penetapan role, dan akses unit kerja sistem
                    </p>
                </div>
                <Button className="shadow-sm bg-indigo-600 hover:bg-indigo-700" onClick={handleAddUser}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Tambah User
                </Button>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="shadow-sm border-l-4 border-l-blue-500">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                        <Users className="h-4 w-4 text-blue-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">{pagination.total}</div>
                        <p className="text-xs text-muted-foreground mt-1">Pengguna terdaftar</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-green-500">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Aktif</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-700 dark:text-green-300">
                            {/* Ideally fetch from stats endpoint, simplified here */}
                            {users.filter(u => u.isActive).length}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Pengguna aktif (halaman ini)</p>
                    </CardContent>
                </Card>
                <Card className="shadow-sm border-l-4 border-l-slate-400">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Nonaktif</CardTitle>
                        <Ban className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-foreground">
                            {users.filter(u => !u.isActive).length}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Pengguna nonaktif (halaman ini)</p>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <Card className="shadow-sm border-border/60">
                <CardHeader className="pb-4 bg-muted/20">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <div className="relative flex-1 w-full sm:w-auto">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Cari nama atau email..."
                                value={search}
                                onChange={(e) => applyFilter(setSearch)(e.target.value)}
                                className="pl-9 bg-background focus:bg-background"
                            />
                        </div>
                        <div className="flex items-center gap-2 w-full sm:w-auto">
                            <Select value={roleFilter} onValueChange={applyFilter(setRoleFilter)}>
                                <SelectTrigger className="w-full sm:w-[180px] bg-background">
                                    <SelectValue placeholder="Filter Role" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Semua Role</SelectItem>
                                    {roles.map(role => (
                                        <SelectItem key={role.value} value={role.value}>
                                            {role.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={unitKerjaFilter} onValueChange={applyFilter(setUnitKerjaFilter)}>
                                <SelectTrigger className="w-full sm:w-[180px] bg-background">
                                    <SelectValue placeholder="Filter Unit" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Semua Unit</SelectItem>
                                    {unitKerjaList.map(unit => (
                                        <SelectItem key={unit.id} value={unit.id}>
                                            {unit.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <div className="flex flex-col items-center gap-2">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                <p className="text-sm text-muted-foreground">Memuat data pengguna...</p>
                            </div>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <AlertTriangle className="h-12 w-12 text-yellow-500" />
                            <p className="text-muted-foreground">{error}</p>
                            <Button onClick={loadUsers} variant="outline">Coba Lagi</Button>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow className="hover:bg-transparent">
                                    <TableHead className="w-[300px]">User</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Unit Kerja</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Aksi</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {users.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center py-16 text-muted-foreground">
                                            <div className="p-4 bg-muted/50 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                                                <Users className="h-8 w-8 opacity-20" />
                                            </div>
                                            <h3 className="text-lg font-medium mb-1">Tidak ditemukan</h3>
                                            <p className="text-sm opacity-80">Tidak ada user yang cocok dengan kriteria pencarian</p>
                                        </TableCell>
                                    </TableRow>
                                ) : users.map((user) => (
                                    <TableRow key={user.id} className="group hover:bg-muted/50 transition-colors">
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-9 w-9 border border-border">
                                                    <AvatarImage src={user.image} />
                                                    <AvatarFallback className={`${getAvatarColor(user.name)} text-white`}>
                                                        {getInitials(user.name)}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <p className="font-medium text-sm text-foreground">{user.name || '-'}</p>
                                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <Mail className="h-3 w-3" /> {user.email}
                                                    </p>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={`font-medium shadow-none ${ROLE_COLORS[user.role] || ''}`}>
                                                {ROLE_LABELS[user.role] || user.role}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            {user.unitKerjaName ? (
                                                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                                    <Building2 className="h-3.5 w-3.5" />
                                                    {user.unitKerjaName}
                                                </div>
                                            ) : (
                                                <span className="text-muted-foreground text-xs italic">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={user.isActive ? 'default' : 'secondary'}
                                                className={user.isActive ? "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-300 hover:bg-green-200 border-green-200 shadow-none border" : "bg-muted text-muted-foreground border-border shadow-none border"}
                                            >
                                                {user.isActive ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <Ban className="w-3 h-3 mr-1" />}
                                                {user.isActive ? 'Aktif' : 'Nonaktif'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-48">
                                                    <DropdownMenuLabel>Aksi User</DropdownMenuLabel>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem onClick={() => handleEdit(user)}>
                                                        <Edit2 className="h-4 w-4 mr-2" />
                                                        Edit Role/Unit
                                                    </DropdownMenuItem>
                                                    {user.id !== currentUser?.id && (
                                                        <DropdownMenuItem
                                                            onClick={() => user.isActive ? handleDeactivate(user) : handleActivate(user)}
                                                            className={user.isActive ? "text-red-600 focus:text-red-600" : "text-green-600 focus:text-green-600"}
                                                        >
                                                            {user.isActive ? (
                                                                <>
                                                                    <UserX className="h-4 w-4 mr-2" />
                                                                    Nonaktifkan
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <CheckCircle2 className="h-4 w-4 mr-2" />
                                                                    Aktifkan
                                                                </>
                                                            )}
                                                        </DropdownMenuItem>
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>

                {/* Pagination */}
                {pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-4 border-t bg-muted/20">
                        <p className="text-sm text-muted-foreground">
                            Halaman <span className="font-medium text-foreground">{pagination.page}</span> dari <span className="font-medium text-foreground">{pagination.totalPages}</span>
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={pagination.page <= 1}
                                onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                                className="h-8"
                            >
                                Sebelumnya
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={pagination.page >= pagination.totalPages}
                                onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                                className="h-8"
                            >
                                Selanjutnya
                            </Button>
                        </div>
                    </div>
                )}
            </Card>

            {/* Edit Sheet Modal */}
            <Sheet open={editOpen} onOpenChange={setEditOpen}>
                <SheetContent className="sm:max-w-md">
                    <SheetHeader>
                        <SheetTitle className="flex items-center gap-2">
                            <div className="p-1.5 bg-primary/10 rounded-md">
                                <Edit2 className="h-4 w-4 text-primary" />
                            </div>
                            Edit User
                        </SheetTitle>
                        <SheetDescription>
                            Ubah role dan unit kerja untuk <span className="font-medium text-foreground">{editingUser?.name || editingUser?.email}</span>
                        </SheetDescription>
                    </SheetHeader>

                    <div className="py-6 space-y-6">
                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Role Pengguna</label>
                            <Select value={editData.role} onValueChange={(v) => setEditData(d => ({ ...d, role: v }))}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Pilih Role" />
                                </SelectTrigger>
                                <SelectContent>
                                    {roles.map(role => (
                                        <SelectItem key={role.value} value={role.value}>
                                            {role.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Role menentukan hak akses pengguna dalam sistem.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Unit Kerja</label>
                            <Select value={editData.unitKerjaId || 'none'} onValueChange={(v) => setEditData(d => ({ ...d, unitKerjaId: v === 'none' ? '' : v }))}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Pilih Unit Kerja" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none" className="text-muted-foreground opacity-50">Tidak ada unit kerja</SelectItem>
                                    {unitKerjaList.map(unit => (
                                        <SelectItem key={unit.id} value={unit.id}>
                                            {unit.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                Unit kerja membatasi data yang dapat dilihat dan dikelola.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Status Akun</label>
                            <Select value={String(editData.isActive)} onValueChange={(v) => setEditData(d => ({ ...d, isActive: v === 'true' }))}>
                                <SelectTrigger className={editData.isActive ? "border-green-200 bg-green-50 dark:bg-green-500/15 text-green-900 dark:text-green-300" : "border-red-200 bg-red-50 dark:bg-red-500/15 text-red-900 dark:text-red-300"}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="true">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                                            <span>Aktif</span>
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="false">
                                        <div className="flex items-center gap-2">
                                            <Ban className="h-4 w-4 text-red-600" />
                                            <span>Nonaktif</span>
                                        </div>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">Jabatan</label>
                            <Input
                                placeholder="Contoh: Arsiparis, Kepala Seksi"
                                value={editData.jabatan}
                                onChange={(e) => setEditData(d => ({ ...d, jabatan: e.target.value }))}
                                maxLength={100}
                            />
                            <p className="text-xs text-muted-foreground">
                                Jabatan/posisi pengguna, digunakan di dokumen Berita Acara Autentikasi.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium leading-none">NIP</label>
                            <Input
                                placeholder="Nomor Induk Pegawai"
                                value={editData.nip}
                                onChange={(e) => setEditData(d => ({ ...d, nip: e.target.value }))}
                                maxLength={30}
                            />
                            <p className="text-xs text-muted-foreground">
                                NIP muncul di tanda tangan dokumen resmi.
                            </p>
                        </div>
                    </div>

                    <SheetFooter>
                        <Button variant="outline" onClick={() => setEditOpen(false)}>
                            Batal
                        </Button>
                        <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90">
                            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Simpan Perubahan
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>

            {/* Add User Dialog */}
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UserPlus className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                            Tambah User Baru
                        </DialogTitle>
                        <DialogDescription>
                            Buat akun user baru. User akan dapat login menggunakan email + password atau Google.
                        </DialogDescription>
                    </DialogHeader>

                    {addError && (
                        <div className="bg-red-50 dark:bg-red-500/15 border border-red-200 rounded-lg p-3 flex items-center gap-2 text-sm text-red-700 dark:text-red-300">
                            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                            {addError}
                        </div>
                    )}

                    <div className="space-y-4 py-2">
                        <div className="space-y-2">
                            <Label>Email <span className="text-red-500">*</span></Label>
                            <Input
                                type="email"
                                placeholder="user@example.com"
                                value={addData.email}
                                onChange={(e) => setAddData(d => ({ ...d, email: e.target.value }))}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Nama Lengkap <span className="text-red-500">*</span></Label>
                            <Input
                                placeholder="Nama lengkap pengguna"
                                value={addData.name}
                                onChange={(e) => setAddData(d => ({ ...d, name: e.target.value }))}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Role</Label>
                            <Select value={addData.role} onValueChange={(v) => setAddData(d => ({ ...d, role: v }))}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Pilih Role" />
                                </SelectTrigger>
                                <SelectContent>
                                    {roles.map(role => (
                                        <SelectItem key={role.value} value={role.value}>
                                            {role.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Unit Kerja</Label>
                            <Select value={addData.unitKerjaId || 'none'} onValueChange={(v) => setAddData(d => ({ ...d, unitKerjaId: v === 'none' ? '' : v }))}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Pilih Unit Kerja" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none" className="text-muted-foreground opacity-50">Tidak ada unit kerja</SelectItem>
                                    {unitKerjaList.map(unit => (
                                        <SelectItem key={unit.id} value={unit.id}>
                                            {unit.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Jabatan</Label>
                                <Input
                                    placeholder="Contoh: Arsiparis"
                                    value={addData.jabatan}
                                    onChange={(e) => setAddData(d => ({ ...d, jabatan: e.target.value }))}
                                    maxLength={100}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>NIP</Label>
                                <Input
                                    placeholder="Nomor Induk Pegawai"
                                    value={addData.nip}
                                    onChange={(e) => setAddData(d => ({ ...d, nip: e.target.value }))}
                                    maxLength={30}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="flex items-center gap-1.5">
                                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                                Password
                            </Label>
                            <div className="relative">
                                <Input
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="Minimal 8 karakter"
                                    value={addData.password}
                                    onChange={(e) => setAddData(d => ({ ...d, password: e.target.value }))}
                                    maxLength={128}
                                    className="pr-10"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-0 top-0 h-full w-10 hover:bg-transparent text-muted-foreground"
                                    onClick={() => setShowPassword(v => !v)}
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </Button>
                            </div>
                            {addData.password && (
                                <div className="space-y-1.5">
                                    <div className="flex gap-1">
                                        {[1, 2, 3, 4].map(i => (
                                            <div
                                                key={i}
                                                className={`h-1.5 flex-1 rounded-full transition-colors ${i <= passwordStrength.score ? passwordStrength.color : 'bg-muted'
                                                    }`}
                                            />
                                        ))}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Kekuatan: <span className="font-medium">{passwordStrength.label}</span>
                                    </p>
                                </div>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Opsional. Jika diisi, user dapat login via email + password. Jika tidak, user hanya bisa login via Google.
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAddOpen(false)} disabled={creating}>
                            Batal
                        </Button>
                        <Button onClick={handleCreateUser} disabled={creating} className="bg-indigo-600 hover:bg-indigo-700">
                            {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                            Tambah User
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
