import React, { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Backdrop
} from '@mui/material';

// Define the confirmation options interface
interface ConfirmationOptions {
    title?: string;
    confirmText?: string;
    cancelText?: string;
}

// Define the context type
interface ConfirmationContextType {
    confirm: (message: string, options?: ConfirmationOptions) => Promise<boolean>;
}

// Create the context
const ConfirmationContext = createContext<ConfirmationContextType | undefined>(undefined);

// Define the provider props
interface ConfirmationProviderProps {
    children: ReactNode;
}

// Confirmation dialog state interface
interface DialogState {
    open: boolean;
    message: string;
    title?: string;
    confirmText: string;
    cancelText: string;
    resolver?: (value: boolean) => void;
}

// Create the provider component
export function ConfirmationProvider({ children }: ConfirmationProviderProps) {
    const [dialogState, setDialogState] = useState<DialogState>({
        open: false,
        message: '',
        confirmText: 'Confirm',
        cancelText: 'Cancel'
    });

    // Function to show confirmation dialog
    const confirm = (message: string, options?: ConfirmationOptions): Promise<boolean> => {
        return new Promise((resolve) => {
            setDialogState({
                open: true,
                message,
                title: options?.title,
                confirmText: options?.confirmText || 'Confirm',
                cancelText: options?.cancelText || 'Cancel',
                resolver: resolve
            });
        });
    };

    // Handle confirm action
    const handleConfirm = () => {
        if (dialogState.resolver) {
            dialogState.resolver(true);
        }
        closeDialog();
    };

    // Handle cancel action
    const handleCancel = () => {
        if (dialogState.resolver) {
            dialogState.resolver(false);
        }
        closeDialog();
    };

    // Close dialog and reset state
    const closeDialog = () => {
        setDialogState({
            open: false,
            message: '',
            confirmText: 'Confirm',
            cancelText: 'Cancel'
        });
    };

    const contextValue = {
        confirm
    };

    return (
        <ConfirmationContext.Provider value={contextValue}>
            {children}

            {/* Confirmation Dialog */}
            <Dialog
                open={dialogState.open}
                onClose={handleCancel}
                maxWidth="sm"
                fullWidth
                BackdropComponent={Backdrop}
                BackdropProps={{
                    sx: {
                        backgroundColor: 'rgba(0, 0, 0, 0.5)', // Semi-transparent overlay
                    }
                }}
                PaperProps={{
                    sx: {
                        borderRadius: 2,
                        padding: 1
                    }
                }}
            >
                {dialogState.title && (
                    <DialogTitle>
                        <Typography variant="h6" component="h2">
                            {dialogState.title}
                        </Typography>
                    </DialogTitle>
                )}

                <DialogContent>
                    <Typography variant="body1">
                        {dialogState.message}
                    </Typography>
                </DialogContent>

                <DialogActions sx={{ padding: 2, gap: 1 }}>
                    {/* Cancel button on the left with less emphasis */}
                    <Button
                        onClick={handleCancel}
                        variant="outlined"
                        color="inherit"
                    >
                        {dialogState.cancelText}
                    </Button>

                    {/* Confirm button on the right with more emphasis */}
                    <Button
                        onClick={handleConfirm}
                        variant="contained"
                        color="primary"
                        autoFocus
                    >
                        {dialogState.confirmText}
                    </Button>
                </DialogActions>
            </Dialog>
        </ConfirmationContext.Provider>
    );
}

// Custom hook to use the confirmation context
export function useConfirmation() {
    const context = useContext(ConfirmationContext);
    if (context === undefined) {
        throw new Error('useConfirmation must be used within a ConfirmationProvider');
    }
    return context;
}
