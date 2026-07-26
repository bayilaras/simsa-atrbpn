import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';

export default function Login() {
    const { signInWithGoogle, signInWithEmail, loading, error, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [localError, setLocalError] = useState('');

    // Redirect to dashboard if already authenticated
    if (isAuthenticated) {
        return <Navigate to="/" replace />;
    }

    const handleEmailLogin = async (e) => {
        e.preventDefault();
        setLocalError('');
        try {
            await signInWithEmail(email, password);
            navigate('/', { replace: true });
        } catch (err) {
            setLocalError(err.message || 'Login gagal');
        }
    };

    const displayError = localError || error;

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/90 via-primary/70 to-secondary/30 relative overflow-hidden">
            {/* Animated Background Shapes */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
                <div className="absolute top-[10%] left-[10%] w-72 h-72 bg-primary/20 rounded-full blur-3xl animate-pulse-glow"></div>
                <div className="absolute bottom-[10%] right-[10%] w-96 h-96 bg-secondary/20 rounded-full blur-3xl animate-pulse-glow delay-1000"></div>
                <div className="absolute top-[40%] left-[60%] w-48 h-48 bg-card/10 rounded-full blur-2xl animate-pulse"></div>
            </div>

            <div className="w-full max-w-md px-4 relative z-10 animate-fade-in-up">
                <div className="text-center mb-6 space-y-2">
                    <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-card/10 backdrop-blur-sm border border-white/20 shadow-xl mb-2">
                        <img
                            src="/logo-simsa.png"
                            alt="Logo SIMSA"
                            className="w-12 h-12"
                        />
                    </div>
                    <div className="space-y-0.5">
                        <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-sm">SIMSA</h1>
                        <p className="text-primary-foreground/90 font-medium text-sm tracking-wide uppercase opacity-90">Sistem Informasi Manajemen Surat & Arsip</p>
                        <p className="text-primary-foreground/70 text-xs">ATR/BPN - Dirjen PTPP</p>
                    </div>
                </div>

                <Card className="border-white/20 bg-card/95 backdrop-blur-xl shadow-2xl">
                    <CardHeader className="space-y-1 pb-4">
                        <CardTitle className="text-xl font-semibold text-center text-foreground/80">Selamat Datang</CardTitle>
                        <CardDescription className="text-center">
                            Silakan masuk untuk mengakses sistem
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-0">
                        {displayError && (
                            <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm animate-in fade-in slide-in-from-top-1">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                <span>{displayError}</span>
                            </div>
                        )}

                        <form onSubmit={handleEmailLogin} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="nama@email.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="bg-background/50 focus:bg-background transition-colors"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">Password</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="bg-background/50 focus:bg-background transition-colors"
                                />
                            </div>
                            <Button
                                type="submit"
                                className="w-full bg-primary hover:bg-primary/90 transition-all duration-300 shadow-md hover:shadow-lg"
                                disabled={loading}
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Memproses...
                                    </>
                                ) : 'Masuk'}
                            </Button>
                        </form>

                        <div className="relative py-2">
                            <div className="absolute inset-0 flex items-center">
                                <Separator className="w-full bg-border/60" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-card px-2 text-muted-foreground font-medium">Atau lanjutkan dengan</span>
                            </div>
                        </div>

                        <Button
                            onClick={signInWithGoogle}
                            disabled={loading}
                            variant="outline"
                            className="w-full bg-card hover:bg-muted/50 text-foreground border-border hover:border-border shadow-sm transition-all duration-300"
                            size="lg"
                        >
                            <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                                <path
                                    fill="#4285F4"
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                />
                                <path
                                    fill="#34A853"
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                />
                                <path
                                    fill="#FBBC05"
                                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                />
                                <path
                                    fill="#EA4335"
                                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                />
                            </svg>
                            {loading ? 'Memuat...' : 'Google'}
                        </Button>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-2 pb-6 pt-2">
                        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground/80">
                            <CheckCircle2 className="h-3 w-3 text-primary" />
                            <span>Secure System</span>
                            <span className="text-border">|</span>
                            <span>Versi 1.0.0 (BETA)</span>
                        </div>
                        <p className="text-[10px] text-center text-muted-foreground/60">
                            &copy; 2024 Kementerian Agraria dan Tata Ruang/BPN
                        </p>
                    </CardFooter>
                </Card>
            </div>
        </div>
    );
}
