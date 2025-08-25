import { useState } from 'react';
import { useAuth } from './AuthContext';
import {
   Box,
   Card,
   CardContent,
   Typography,
   TextField,
   Button,
   Alert,
   Divider,
   CircularProgress
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

interface VocabEntryFormData {
   entryKey: string;
   entryValue: string;
}

interface DataFormProps {
   onDataAdded: () => void;
}

const DataForm = ({ onDataAdded }: DataFormProps) => {
   const { token } = useAuth();
   const [formData, setFormData] = useState<VocabEntryFormData>({
      entryKey: '',
      entryValue: ''
   });
   const [isSubmitting, setIsSubmitting] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [errorCode, setErrorCode] = useState<string | null>(null);
   const [success, setSuccess] = useState(false);

   const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const { name, value } = e.target;
      setFormData(prev => ({
         ...prev,
         [name]: value
      }));
   };

   const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSubmitting(true);
      setError(null);
      setErrorCode(null);
      setSuccess(false);

      try {
         const response = await fetch('http://localhost:3001/api/vocabEntries', {
            method: 'POST',
            headers: {
               'Content-Type': 'application/json',
               'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(formData)
         });

         if (!response.ok) {
            const errorData = await response.json();
            throw {
               message: errorData.error || 'Failed to add vocabulary entry',
               code: errorData.code || 'ERR_UNKNOWN'
            };
         }

         setFormData({
            entryKey: '',
            entryValue: ''
         });
         setSuccess(true);
         onDataAdded();
      } catch (err: any) {
         const errorMessage = err.message || 'Failed to add vocabulary entry. Please try again.';
         const errorCode = err.code || 'ERR_UNKNOWN';
         setError(errorMessage);
         setErrorCode(errorCode);
         console.error(err);
      } finally {
         setIsSubmitting(false);
      }
   };

   return (
      <Box>
         <Card
            sx={{
               height: '100%',
               display: 'flex',
               flexDirection: 'column'
            }}
         >
            <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
               <Typography variant="h5" component="h2" gutterBottom>
                  Add New Vocabulary Entry
               </Typography>
               <Divider sx={{ mb: 2 }} />

               {error && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                     {error} {errorCode && <span>[Error Code: {errorCode}]</span>}
                  </Alert>
               )}
               {success && <Alert severity="success" sx={{ mb: 2 }}>Vocabulary entry added successfully!</Alert>}

               <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                  <TextField
                     label="Term"
                     id="entryKey"
                     name="entryKey"
                     value={formData.entryKey}
                     onChange={handleChange}
                     required
                     fullWidth
                     margin="normal"
                     variant="outlined"
                     size="small"
                  />

                  <TextField
                     label="Definition"
                     id="entryValue"
                     name="entryValue"
                     value={formData.entryValue}
                     onChange={handleChange}
                     required
                     fullWidth
                     multiline
                     rows={3}
                     margin="normal"
                     variant="outlined"
                     sx={{ mb: 2, flexGrow: 1 }}
                  />

                  <Divider sx={{ mt: 'auto', mb: 2 }} />

                  <Button
                     type="submit"
                     variant="contained"
                     color="primary"
                     disabled={isSubmitting}
                     startIcon={isSubmitting ? <CircularProgress size={20} color="inherit" /> : <AddIcon />}
                     fullWidth
                  >
                     {isSubmitting ? 'Adding...' : 'Add Vocabulary Entry'}
                  </Button>
               </Box>
            </CardContent>
         </Card>
      </Box>
   );
};

export default DataForm;
