import { PatientCompanionSafetyService } from './patient-companion-safety.service';

describe('PatientCompanionSafetyService', () => {
  const service = new PatientCompanionSafetyService();

  it('blocks self-harm crisis language with tele-MANAS helpline', () => {
    const result = service.evaluate('I feel like I want to die and kill myself');
    expect(result).toMatchObject({
      blocked: true,
      reasonCode: 'SELF_HARM_CRISIS',
    });
    expect(result.response).toContain('14416');
  });

  it('allows open medical symptom and diagnostic questions', () => {
    const result = service.evaluate('I have left chest pain lasting 1 to 2 seconds');
    expect(result).toEqual({
      blocked: false,
    });
  });

  it('sanitizes and preserves formatted clinical model responses', () => {
    const response = '### Differential Diagnosis\n- Musculoskeletal pain\n- Costochondritis';
    expect(service.sanitizeModelResponse(response)).toBe(response);
  });
});
