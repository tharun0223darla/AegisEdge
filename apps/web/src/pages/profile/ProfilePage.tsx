import React, { useState, useEffect } from 'react';
import { useProfile, useCreateProfile, useUpdateProfile } from '@/hooks/useProfile';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Spinner } from '@/components/ui/Spinner';
import { notify } from '@/components/ui/Toast';
import { Avatar } from '@/components/ui/Avatar';
import { User, ShieldAlert, HeartHandshake, Scale, Ruler, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';

export default function ProfilePage() {
  const { data: profile, isLoading, error, refetch } = useProfile();
  const createMutation = useCreateProfile();
  const updateMutation = useUpdateProfile();

  // Avatar presets
  const avatarPresets = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=256',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=256',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=256',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=256',
  ];

  // Form State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [allergiesInput, setAllergiesInput] = useState('');
  const [conditionsInput, setConditionsInput] = useState('');
  const [notes, setNotes] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  const isNewProfile = error && (error as any).status === 404;

  // Sync form states with profile data
  useEffect(() => {
    if (profile) {
      setFirstName(profile.firstName || '');
      setLastName(profile.lastName || '');
      setDateOfBirth(profile.dateOfBirth ? format(parseISO(profile.dateOfBirth), 'yyyy-MM-dd') : '');
      setGender(profile.gender || '');
      setBloodGroup(profile.bloodGroup || '');
      setHeight(profile.height ? String(profile.height) : '');
      setWeight(profile.weight ? String(profile.weight) : '');
      setEmergencyContact(profile.emergencyContact || '');
      setEmergencyPhone(profile.emergencyPhone || '');
      setAllergiesInput(profile.allergies?.join(', ') || '');
      setConditionsInput(profile.conditions?.join(', ') || '');
      setNotes(profile.notes || '');
      setAvatarUrl(profile.avatarUrl || '');
    }
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName || !lastName) {
      notify.error('First name and Last name are required');
      return;
    }

    const payload = {
      firstName,
      lastName,
      dateOfBirth: dateOfBirth || null,
      gender: gender || null,
      bloodGroup: bloodGroup || null,
      height: height ? parseFloat(height) : null,
      weight: weight ? parseFloat(weight) : null,
      emergencyContact: emergencyContact || null,
      emergencyPhone: emergencyPhone || null,
      allergies: allergiesInput.split(',').map(s => s.trim()).filter(Boolean),
      conditions: conditionsInput.split(',').map(s => s.trim()).filter(Boolean),
      notes: notes || null,
      avatarUrl: avatarUrl || null,
    };

    try {
      if (isNewProfile) {
        await createMutation.mutateAsync(payload);
        notify.success('Profile created successfully!');
      } else {
        await updateMutation.mutateAsync(payload);
        notify.success('Profile updated successfully!');
      }
      refetch();
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Failed to save profile details');
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-24 space-y-4">
        <Spinner size="lg" className="text-brand-500" />
        <span className="text-text-muted text-sm font-medium">Retrieving medical profile...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <PageHeader 
        title="Patient Profile" 
        description={isNewProfile ? "Complete your patient profile to begin logging records." : "View and manage your personal details and medical files."} 
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="p-6 bg-slate-900 border-slate-800 shadow-2xl space-y-6">
          <div className="flex flex-col md:flex-row gap-6 items-center md:items-start border-b border-slate-800 pb-6">
            <div className="flex flex-col items-center space-y-2 shrink-0">
              <Avatar 
                name={`${firstName || 'New'} ${lastName || 'User'}`} 
                src={avatarUrl} 
                size="lg" 
                className="h-24 w-24 text-xl border-2 border-brand-500/20 shadow-glow"
              />
              <span className="text-xs text-text-muted">Select Avatar Profile</span>
            </div>

            <div className="flex-1 space-y-4 text-center md:text-left">
              <h3 className="text-base font-semibold text-text-primary">Choose avatar preset</h3>
              <div className="flex justify-center md:justify-start gap-3 flex-wrap">
                {avatarPresets.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setAvatarUrl(preset)}
                    className={`h-12 w-12 rounded-full overflow-hidden border-2 transition-all ${
                      avatarUrl === preset ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <img src={preset} alt="Preset avatar" className="h-full w-full object-cover" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setAvatarUrl('')}
                  className={`h-12 w-12 rounded-full border-2 border-dashed flex items-center justify-center text-xs font-semibold transition-all ${
                    !avatarUrl ? 'border-brand-500 text-brand-400 bg-brand-500/10' : 'border-slate-800 text-text-muted hover:border-slate-700'
                  }`}
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">First Name</label>
              <Input
                type="text"
                placeholder="Ravi"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Last Name</label>
              <Input
                type="text"
                placeholder="Kumar"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Date of Birth</label>
              <Input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Gender</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 w-full text-text-primary"
              >
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Health Metrics & Medical Card */}
        <Card className="p-6 bg-slate-900 border-slate-800 shadow-2xl space-y-6">
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <User className="h-5 w-5 text-brand-500" />
            Medical Information
          </h3>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5 mb-1">
                <Ruler className="h-3.5 w-3.5" /> Height (cm)
              </label>
              <Input
                type="number"
                placeholder="175"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                min="50"
                max="250"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5 mb-1">
                <Scale className="h-3.5 w-3.5" /> Weight (kg)
              </label>
              <Input
                type="number"
                placeholder="72"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                min="10"
                max="500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 block">Blood Group</label>
              <select
                value={bloodGroup}
                onChange={(e) => setBloodGroup(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 w-full text-text-primary"
              >
                <option value="">Select blood type</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
              </select>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <ShieldAlert className="h-3.5 w-3.5 text-danger" /> Allergies (comma-separated)
              </label>
              <Input
                type="text"
                placeholder="Penicillin, Peanuts, Sulfa drugs"
                value={allergiesInput}
                onChange={(e) => setAllergiesInput(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <HeartHandshake className="h-3.5 w-3.5 text-brand-500" /> Chronic Conditions (comma-separated)
              </label>
              <Input
                type="text"
                placeholder="Hypertension, Diabetes Type 2, Asthma"
                value={conditionsInput}
                onChange={(e) => setConditionsInput(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5 mb-2">
                <FileText className="h-3.5 w-3.5 text-text-muted" /> Medical History Notes
              </label>
              <Textarea
                placeholder="Any special notes or medical warnings."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </Card>

        {/* Emergency Contact Card */}
        <Card className="p-6 bg-slate-900 border-slate-800 shadow-2xl space-y-6">
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <HeartHandshake className="h-5 w-5 text-indigo-400" />
            Emergency Contacts
          </h3>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Contact Name</label>
              <Input
                type="text"
                placeholder="Dr. Priya Sharma (Family Doctor)"
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Contact Phone</label>
              <Input
                type="tel"
                placeholder="+919876543210"
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value)}
              />
            </div>
          </div>
        </Card>

        <div className="flex justify-end gap-3">
          <Button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 bg-gradient-brand text-text-inverse hover:shadow-glow transition-all"
          >
            {isSaving ? 'Saving profile...' : isNewProfile ? 'Create Profile' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}
