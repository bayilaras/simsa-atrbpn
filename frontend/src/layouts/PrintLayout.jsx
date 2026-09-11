import React from 'react';
import { Outlet } from 'react-router-dom';
import { AppServiceNotice } from '@/components/AppServiceNotice';

const PrintLayout = () => {
    return (
        <div className="print-layout min-h-screen bg-white">
            <div className="p-4 print:hidden"><AppServiceNotice /></div>
            <div className="print-content">
                <Outlet />
            </div>
        </div>
    );
};

export default PrintLayout;
