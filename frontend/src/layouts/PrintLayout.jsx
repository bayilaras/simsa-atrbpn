import React from 'react';
import { Outlet } from 'react-router-dom';

const PrintLayout = () => {
    return (
        <div className="print-layout min-h-screen bg-white">
            <div className="print-content">
                <Outlet />
            </div>
        </div>
    );
};

export default PrintLayout;
