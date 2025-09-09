import twilio  from "twilio";


export const sendOTP = async (countryCode, mobileNumber, otp) => {
        try {

           if (!process.env.TWILIO_ACCOUNT_SID || 
                !process.env.TWILIO_AUTH_TOKEN || 
                !process.env.TWILIO_VERIFY_SID) {
                throw new Error('Twilio credentials not configured');
            }

            const client = twilio(
                process.env.TWILIO_ACCOUNT_SID,
                process.env.TWILIO_AUTH_TOKEN
            );
            const toNumber = mobileNumber.startsWith('+') ? mobileNumber : `${countryCode}${mobileNumber.replace(/\D/g, '')}`;

                
            // const verification = await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
            // .verifications
            // .create({ to: toNumber, channel: 'sms' });
            //         console.log('Verification status:', verification.status);
                
            const message = await client.messages.create({
                body: `Your verification code for NestBubble is: ${otp}. Valid for 10 minutes.`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: toNumber
            });

          return true;

        } catch (twilioError) {
            console.error('Twilio SMS failed:', {
                error: twilioError,
                code: twilioError.code,
                moreInfo: twilioError.moreInfo
            });
          return false;
        }
};
